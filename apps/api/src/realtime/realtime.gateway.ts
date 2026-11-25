import { Logger } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, WebSocketGateway } from '@nestjs/websockets';
import type { IncomingMessage } from 'node:http';
import type { WebSocket } from 'ws';
import { PERMISSIONS } from '../permissions/permission-catalog';
import { RealtimeService, type RealtimeEvent } from './realtime.service';
import { WsAuthService } from './ws-auth.service';

interface Client {
  socket: WebSocket;
  userId: string;
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
  ) {}

  afterInit(): void {
    this.realtime.events.subscribe((event) => this.broadcast(event));
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
    const user = await this.wsAuth.authenticate(request);
    if (!user) {
      socket.close(4001, 'unauthorized');
      return;
    }
    if (!user.permissions.includes(PERMISSIONS.DASHBOARD_READ)) {
      socket.close(4003, 'forbidden');
      return;
    }
    const client: Client = { socket, userId: user.id, alive: true };
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
