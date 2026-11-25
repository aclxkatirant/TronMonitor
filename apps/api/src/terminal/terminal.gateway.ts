import { Logger } from '@nestjs/common';
import { OnGatewayConnection, WebSocketGateway } from '@nestjs/websockets';
import type { IncomingMessage } from 'node:http';
import type { WebSocket } from 'ws';
import { AppError, type ErrorBody } from '../common/app-error';
import { MESSAGES } from '../common/messages';
import { PERMISSIONS } from '../permissions/permission-catalog';
import { AgentAuthGuard } from '../agents/agent-auth.guard';
import { WsAuthService, remoteIp } from '../realtime/ws-auth.service';
import { TerminalService, type LiveSession } from './terminal.service';
import type { BrowserMessage } from './terminal.types';

const MAX_INPUT_BYTES = 64 * 1024;

/**
 * Tarayıcı terminal kanalı. Her soket en fazla bir oturum taşır: önce `open` mesajı gelir, ardından
 * `input`/`resize`; kabuk çıktısı ikili çerçevelerle istemciye akar. `terminal.use` izni gerekir.
 */
@WebSocketGateway({ path: '/api/v1/terminal' })
export class TerminalGateway implements OnGatewayConnection {
  private readonly logger = new Logger(TerminalGateway.name);

  constructor(
    private readonly wsAuth: WsAuthService,
    private readonly terminal: TerminalService,
  ) {}

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
    if (!user.permissions.includes(PERMISSIONS.TERMINAL_USE)) {
      socket.close(4003, 'forbidden');
      return;
    }
    const ip = remoteIp(request);
    let session: LiveSession | null = null;
    let opening = false;

    socket.on('message', (raw: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
      const buf = Array.isArray(raw) ? Buffer.concat(raw) : Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      if (buf.length > MAX_INPUT_BYTES) return;
      if (isBinary) {
        if (session) this.terminal.input(session, buf.toString('utf8'));
        return;
      }
      let msg: BrowserMessage;
      try {
        msg = JSON.parse(buf.toString('utf8')) as BrowserMessage;
      } catch {
        return;
      }
      switch (msg.type) {
        case 'open':
          if (session || opening) return;
          opening = true;
          this.terminal
            .open(user, ip, socket, { serverId: String(msg.serverId ?? ''), protocol: msg.protocol, cols: msg.cols, rows: msg.rows })
            .then((s) => {
              session = s;
            })
            .catch((error: unknown) => {
              const body = error instanceof AppError ? (error.getResponse() as ErrorBody) : null;
              const code = body?.code ?? null;
              const message = body?.message ?? MESSAGES.INTERNAL_ERROR;
              if (!body) this.logger.error(`Terminal açılırken beklenmeyen hata: ${error instanceof Error ? error.stack : String(error)}`);
              this.logger.warn(`Terminal açılamadı (${user.email}): ${message}`);
              if (socket.readyState === socket.OPEN) {
                socket.send(JSON.stringify({ type: 'error', code, message }));
                socket.close(1000, 'open failed');
              }
            })
            .finally(() => {
              opening = false;
            });
          break;
        case 'input':
          if (session && typeof msg.data === 'string') this.terminal.input(session, msg.data);
          break;
        case 'resize':
          if (session) this.terminal.resize(session, Number(msg.cols), Number(msg.rows));
          break;
        case 'close':
          if (session) this.terminal.browserClosed(session);
          else socket.close(1000, 'closed');
          break;
      }
    });
    socket.on('close', () => {
      if (session) this.terminal.browserClosed(session);
    });
    socket.on('error', (error: Error) => this.logger.debug(`Terminal soketi hatası: ${error.message}`));
    socket.send(JSON.stringify({ type: 'hello', userId: user.id }));
  }
}

/**
 * Ajan terminal kanalı. Ajan, `terminal.open` komutunu alınca bu adrese imzalı başlıklarla bağlanır
 * (`GET /api/v1/agents/terminal?session=<id>` imzaya dahildir). Kabuk çıktısı ikili çerçevelerle gelir.
 */
@WebSocketGateway({ path: '/api/v1/agents/terminal' })
export class AgentTerminalGateway implements OnGatewayConnection {
  private readonly logger = new Logger(AgentTerminalGateway.name);

  constructor(
    private readonly agentAuth: AgentAuthGuard,
    private readonly terminal: TerminalService,
  ) {}

  async handleConnection(socket: WebSocket, request: IncomingMessage): Promise<void> {
    // Mesajlar kimlik doğrulaması bitene kadar tamponlanır; doğrulama başarısızsa soket kapanır.
    socket.pause();
    try {
      const agent = await this.agentAuth.authenticate({
        method: 'GET',
        requestUri: request.url ?? '',
        header: (name) => {
          const value = request.headers[name.toLowerCase()];
          return Array.isArray(value) ? value[0] : value;
        },
        rawBody: Buffer.alloc(0),
      });
      const sessionId = new URL(request.url ?? '/', 'http://localhost').searchParams.get('session') ?? '';
      if (!/^[0-9a-f-]{36}$/i.test(sessionId)) throw AppError.notFound('TERMINAL_SESSION_NOT_FOUND');
      this.terminal.attachAgent(agent, sessionId, socket);
      socket.resume();
    } catch (error) {
      const body = error instanceof AppError ? (error.getResponse() as ErrorBody) : null;
      const code = body?.code ?? 'error';
      this.logger.warn(`Ajan terminal bağlantısı reddedildi: ${code}`);
      socket.close(error instanceof AppError && error.getStatus() === 401 ? 4001 : 4004, code);
    }
  }
}
