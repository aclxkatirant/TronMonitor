import { Logger } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, WebSocketGateway } from '@nestjs/websockets';
import type { IncomingMessage } from 'node:http';
import type { WebSocket } from 'ws';
import { PERMISSIONS } from '../permissions/permission-catalog';
import { SessionService } from '../auth/session.service';
import { RealtimeService, type RealtimeEvent } from './realtime.service';
import { WsAuthService, type WsUser } from './ws-auth.service';

interface Client {
  socket: WebSocket;
  userId: string;
  sessionId: string;
  alive: boolean;
}

const PING_INTERVAL_MS = 30_000;

/**
 * Pano için gerçek zamanlı olay kanalı. Bağlantı, oturum çerezi ve Origin başlığı ile doğrulanır;
 * istemciden komut kabul edilmez (yalnızca sunucudan istemciye yayın).
 */
@WebSocketGateway({ path: '/api/v1/ws' })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly clients = new Map<WebSocket, Client>();
  private pingTimer?: NodeJS.Timeout;

  constructor(
    private readonly realtime: RealtimeService,
    private readonly wsAuth: WsAuthService,
    private readonly sessions: SessionService,
  ) {}

  afterInit(): void {
    this.realtime.events.subscribe((event) => this.broadcast(event));
    // İptal edilen oturumların soketleri hemen kapatılır; olay akışı devam etmez.
    this.sessions.revocations.on('session', (sessionId: string) => this.closeWhere((c) => c.sessionId === sessionId));
    this.sessions.revocations.on('user', (userId: string, except?: string) => this.closeWhere((c) => c.userId === userId && c.sessionId !== except));
    this.pingTimer = setInterval(() => {
      for (const [socket, client] of this.clients) {
        if (!client.alive) {
          socket.terminate();
          this.clients.delete(socket);
          continue;
        }
        client.alive = false;
        socket.ping();
      }
    }, PING_INTERVAL_MS);
    this.pingTimer.unref();
  }

  async handleConnection(socket: WebSocket, request: IncomingMessage): Promise<void> {
    if (!this.wsAuth.isAllowedOrigin(request.headers.origin)) {
      socket.close(4003, 'origin not allowed');
      return;
    }
    let user: WsUser | null = null;
    try {
      user = await this.wsAuth.authenticate(request);
    } catch (error) {
      // Nest, handleConnection'ın Promise'ini beklemez; yakalanmayan ret süreci düşürür.
      this.logger.warn(`WebSocket kimlik doğrulaması başarısız: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!user) {
      socket.close(4001, 'unauthorized');
      return;
    }
    if (!user.permissions.includes(PERMISSIONS.DASHBOARD_READ)) {
      socket.close(4003, 'forbidden');
      return;
    }
    const client: Client = { socket, userId: user.id, sessionId: user.sessionId, alive: true };
    this.clients.set(socket, client);
    socket.on('pong', () => {
      client.alive = true;
    });
    // İstemciden gelen mesajlar yok sayılır; kanal tek yönlüdür.
    socket.on('message', () => undefined);
    socket.send(JSON.stringify({ type: 'hello', payload: { userId: user.id }, at: new Date().toISOString() }));
  }

  handleDisconnect(socket: WebSocket): void {
    this.clients.delete(socket);
  }

  get clientCount(): number {
    return this.clients.size;
  }

  private closeWhere(predicate: (client: Client) => boolean): void {
    for (const [socket, client] of this.clients) {
      if (predicate(client)) {
        this.clients.delete(socket);
        socket.close(4001, 'session revoked');
      }
    }
  }

  private broadcast(event: RealtimeEvent): void {
    if (this.clients.size === 0) return;
    const data = JSON.stringify(event);
    for (const [socket] of this.clients) {
      if (socket.readyState === socket.OPEN) {
        socket.send(data, (error) => {
          if (error) this.logger.debug(`WebSocket gönderimi başarısız: ${error.message}`);
        });
      }
    }
  }
}
