import { Logger } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, WebSocketGateway } from '@nestjs/websockets';
import type { IncomingMessage } from 'node:http';
import type { WebSocket } from 'ws';
import { AppConfigService } from '../config/config.service';
import { SessionService } from '../auth/session.service';
import { PermissionsService } from '../permissions/permissions.service';
import { SESSION_COOKIE_NAME } from '../auth/auth.types';
import { PERMISSIONS } from '../permissions/permission-catalog';
import { RealtimeService, type RealtimeEvent } from './realtime.service';

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
    private readonly sessions: SessionService,
    private readonly permissions: PermissionsService,
    private readonly config: AppConfigService,
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
    const origin = request.headers.origin;
    if (origin && !this.isAllowedOrigin(origin)) {
      socket.close(4003, 'origin not allowed');
      return;
    }
    const token = parseCookie(request.headers.cookie ?? '', SESSION_COOKIE_NAME);
    const validated = token ? await this.sessions.validate(token) : null;
    if (!validated) {
      socket.close(4001, 'unauthorized');
      return;
    }
    const granted = await this.permissions.getEffectivePermissions(validated.user.id, validated.user.role);
    if (!granted.includes(PERMISSIONS.DASHBOARD_READ)) {
      socket.close(4003, 'forbidden');
      return;
    }
    const client: Client = { socket, userId: validated.user.id, alive: true };
    this.clients.set(socket, client);
    socket.on('pong', () => {
      client.alive = true;
    });
    // İstemciden gelen mesajlar yok sayılır; kanal tek yönlüdür.
    socket.on('message', () => undefined);
    socket.send(JSON.stringify({ type: 'hello', payload: { userId: validated.user.id }, at: new Date().toISOString() }));
  }

  handleDisconnect(socket: WebSocket): void {
    this.clients.delete(socket);
  }

  get clientCount(): number {
    return this.clients.size;
  }

  private isAllowedOrigin(origin: string): boolean {
    const allowed = this.config.get('WEB_ORIGIN');
    if (origin === allowed) return true;
    // Geliştirmede localhost ve 127.0.0.1 birbirinin yerine kullanılabilir.
    if (!this.config.isProduction) {
      try {
        const a = new URL(origin);
        const b = new URL(allowed);
        const loopback = (h: string) => h === 'localhost' || h === '127.0.0.1';
        return loopback(a.hostname) && loopback(b.hostname) && a.port === b.port;
      } catch {
        return false;
      }
    }
    return false;
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

function parseCookie(header: string, name: string): string | null {
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}
