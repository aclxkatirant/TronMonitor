import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { WebSocket } from 'ws';
import { AuditResult, TerminalProtocol, TerminalSessionStatus, type AgentCommand, type Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/app-error';
import { MESSAGES, type MessageCode } from '../common/messages';
import { PERMISSIONS } from '../permissions/permission-catalog';
import { ServicesService } from '../services/services.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { AuthenticatedAgent } from '../agents/agent-auth.guard';
import type { WsUser } from '../realtime/ws-auth.service';
import { CredentialsService } from './credentials.service';
import { CommandLineParser } from './command-parser';
import { connectSsh, SshHostKeyMismatchError } from './ssh.backend';
import { TERMINAL_LIMITS, clampSize, type AgentMessage, type TerminalBackend } from './terminal.types';
import type { ListSessionsQueryDto } from './dto/terminal.dto';

export const TERMINAL_STATUS_LABELS: Record<TerminalSessionStatus, string> = {
  CONNECTING: 'Bağlanıyor',
  ACTIVE: 'Etkin',
  CLOSED: 'Kapandı',
  FAILED: 'Başarısız',
  TIMED_OUT: 'Zaman aşımı',
  TERMINATED: 'Sonlandırıldı',
};

export const TERMINAL_PROTOCOL_LABELS: Record<TerminalProtocol, string> = {
  SSH: 'SSH',
  WINRM: 'WinRM',
  AGENT: 'Ajan kabuğu',
};

export interface LiveSession {
  id: string;
  serverId: string;
  serverName: string;
  userId: string;
  userEmail: string;
  protocol: TerminalProtocol;
  browser: WebSocket;
  backend: TerminalBackend | null;
  status: 'CONNECTING' | 'ACTIVE' | 'ENDED';
  parser: CommandLineParser;
  cols: number;
  rows: number;
  startedAt: number;
  commandCount: number;
  /** Henüz tamamlanmamış komut kaydı yazmaları; kapanışta beklenir. */
  logWrites: Promise<void>[];
  agentCommandId?: string;
  idleTimer?: NodeJS.Timeout;
  maxTimer?: NodeJS.Timeout;
  attachTimer?: NodeJS.Timeout;
}

/**
 * Terminal oturumlarının yaşam döngüsü: tarayıcı WebSocket'i ile hedef (SSH kabuğu veya ajan üzerinden
 * yerel kabuk) arasında veri aktarır, yazılan komut satırlarını kaydeder, boşta kalma ve azami süre
 * sınırlarını uygular. Oturumlar süreç belleğindedir; API yeniden başlarsa tüm oturumlar kapanır.
 */
@Injectable()
export class TerminalService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TerminalService.name);
  private readonly live = new Map<string, LiveSession>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly credentials: CredentialsService,
    private readonly services: ServicesService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Önceki süreçten kalan "etkin" görünen oturumlar artık yaşamıyor.
    const stale = await this.prisma.terminalSession.updateMany({
      where: { status: { in: [TerminalSessionStatus.CONNECTING, TerminalSessionStatus.ACTIVE] } },
      data: { status: TerminalSessionStatus.TERMINATED, endedAt: new Date(), endReason: 'Sunucu yeniden başlatıldı' },
    });
    if (stale.count > 0) this.logger.warn(`${stale.count} yarım kalmış terminal oturumu sonlandırıldı olarak işaretlendi`);
    this.services.commandResults.on('result', (command: AgentCommand, ok: boolean, message?: string) => this.onCommandResult(command, ok, message));
  }

  onModuleDestroy(): void {
    for (const session of this.live.values()) void this.end(session, TerminalSessionStatus.TERMINATED, 'Sunucu kapatılıyor');
  }

  get activeCount(): number {
    return this.live.size;
  }

  // ---------------------------------------------------------------------------
  // Oturum açma
  // ---------------------------------------------------------------------------

  async open(user: WsUser, ipAddress: string | null, browser: WebSocket, request: { serverId: string; protocol?: string; cols?: number; rows?: number }): Promise<LiveSession> {
    const mine = [...this.live.values()].filter((s) => s.userId === user.id).length;
    if (mine >= TERMINAL_LIMITS.maxSessionsPerUser) throw AppError.conflict('TERMINAL_LIMIT_REACHED');
    if (!/^[0-9a-f-]{36}$/i.test(request.serverId)) throw AppError.notFound('SERVER_NOT_FOUND');
    const server = await this.prisma.server.findUnique({ where: { id: request.serverId }, include: { agent: { select: { id: true, status: true } } } });
    if (!server) throw AppError.notFound('SERVER_NOT_FOUND');
    const credential = await this.credentials.resolve(server.id);
    const agentReady = server.agent?.status === 'CONNECTED';
    // Tercih belirtilmemişse SSH (kimlik bilgisi varsa), yoksa ajan kabuğu.
    let protocol: TerminalProtocol | null = null;
    if (request.protocol === TerminalProtocol.SSH) protocol = credential ? TerminalProtocol.SSH : null;
    else if (request.protocol === TerminalProtocol.AGENT) protocol = agentReady ? TerminalProtocol.AGENT : null;
    else protocol = credential ? TerminalProtocol.SSH : agentReady ? TerminalProtocol.AGENT : null;
    if (!protocol) throw AppError.conflict('TERMINAL_NO_METHOD');

    const { cols, rows } = clampSize(request.cols, request.rows);
    const row = await this.prisma.terminalSession.create({ data: { serverId: server.id, userId: user.id, protocol, clientIp: ipAddress } });
    const session: LiveSession = { id: row.id, serverId: server.id, serverName: server.name, userId: user.id, userEmail: user.email, protocol, browser, backend: null, status: 'CONNECTING', parser: new CommandLineParser(), cols, rows, startedAt: Date.now(), commandCount: 0, logWrites: [] };
    this.live.set(session.id, session);
    await this.audit.record({ userId: user.id, actorLabel: user.email, action: 'terminal.open', resourceType: 'terminal_session', resourceId: session.id, ipAddress, result: AuditResult.SUCCESS, metadata: { serverId: server.id, serverName: server.name, protocol } });
    this.sendJson(session, { type: 'status', sessionId: session.id, protocol, message: protocol === 'SSH' ? `SSH bağlantısı kuruluyor (${credential!.username}@${credential!.host ?? server.hostname ?? '?'}:${credential!.port})…` : 'Ajan üzerinden kabuk açılıyor…' });
    session.maxTimer = setTimeout(() => void this.end(session, TerminalSessionStatus.TIMED_OUT, 'Azami oturum süresi doldu'), TERMINAL_LIMITS.maxDurationMs);
    this.touch(session);

    if (protocol === TerminalProtocol.SSH) {
      const host = credential!.host ?? server.hostname;
      if (!host) {
        await this.end(session, TerminalSessionStatus.FAILED, 'Bağlantı adresi yok', 'TERMINAL_SSH_FAILED');
        return session;
      }
      void this.startSsh(session, { host, port: credential!.port, username: credential!.username, password: credential!.password, privateKey: credential!.privateKey, passphrase: credential!.passphrase, expectedFingerprint: credential!.hostFingerprint, credentialId: credential!.id });
    } else {
      // Ajan komut yükünü string→string olarak okur; boyutlar metin olarak gönderilir.
      const command = await this.services.enqueueCommand(server.agent!.id, 'terminal.open', { sessionId: session.id, cols: String(cols), rows: String(rows) }, user.id, TERMINAL_LIMITS.agentAttachTimeoutMs);
      session.agentCommandId = command.id;
      session.attachTimer = setTimeout(() => void this.end(session, TerminalSessionStatus.FAILED, MESSAGES.TERMINAL_AGENT_TIMEOUT, 'TERMINAL_AGENT_TIMEOUT'), TERMINAL_LIMITS.agentAttachTimeoutMs);
    }
    return session;
  }

  private async startSsh(session: LiveSession, target: { host: string; port: number; username: string; password?: string; privateKey?: string; passphrase?: string; expectedFingerprint: string | null; credentialId: string }): Promise<void> {
    try {
      const backend = await connectSsh(target, session.cols, session.rows, {
        onData: (data) => this.sendData(session, data),
        onClose: (reason) => void this.end(session, reason ? TerminalSessionStatus.FAILED : TerminalSessionStatus.CLOSED, reason ?? 'Kabuk kapandı'),
        onFingerprint: (fp) => void this.credentials.rememberFingerprint(target.credentialId, fp),
      });
      if (session.status === 'ENDED') {
        backend.close();
        return;
      }
      await this.activate(session, backend);
    } catch (error) {
      if (error instanceof SshHostKeyMismatchError) {
        this.logger.warn(`SSH anahtar uyuşmazlığı: ${session.serverName} (${error.actual})`);
        await this.end(session, TerminalSessionStatus.FAILED, `${MESSAGES.TERMINAL_HOST_KEY_MISMATCH} (${error.actual})`, 'TERMINAL_HOST_KEY_MISMATCH');
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      await this.end(session, TerminalSessionStatus.FAILED, `${MESSAGES.TERMINAL_SSH_FAILED} ${message}`, 'TERMINAL_SSH_FAILED');
    }
  }

  /** Ajan, terminal.open komutunu alınca imzalı WebSocket ile bağlanır ve buraya eklenir. */
  attachAgent(agent: AuthenticatedAgent, sessionId: string, socket: WebSocket): LiveSession {
    const session = this.live.get(sessionId);
    if (!session || session.protocol !== TerminalProtocol.AGENT || session.serverId !== agent.serverId) throw AppError.notFound('TERMINAL_SESSION_NOT_FOUND');
    if (session.status !== 'CONNECTING') throw AppError.conflict('TERMINAL_SESSION_NOT_ACTIVE');
    if (session.attachTimer) clearTimeout(session.attachTimer);
    session.attachTimer = setTimeout(() => void this.end(session, TerminalSessionStatus.FAILED, MESSAGES.TERMINAL_AGENT_TIMEOUT, 'TERMINAL_AGENT_TIMEOUT'), 15_000);

    const backend: TerminalBackend = {
      write: (data) => {
        if (socket.readyState === socket.OPEN) socket.send(typeof data === 'string' ? Buffer.from(data, 'utf8') : data, { binary: true });
      },
      resize: (cols, rows) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: 'resize', cols, rows }));
      },
      close: () => socket.close(1000, 'session ended'),
    };
    socket.on('message', (raw: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
      const buf = Array.isArray(raw) ? Buffer.concat(raw) : Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      if (isBinary) {
        this.sendData(session, buf);
        return;
      }
      let msg: AgentMessage;
      try {
        msg = JSON.parse(buf.toString('utf8')) as AgentMessage;
      } catch {
        return;
      }
      if (msg.type === 'ready') void this.activate(session, backend);
      else if (msg.type === 'exit') void this.end(session, TerminalSessionStatus.CLOSED, msg.message ?? (msg.code !== undefined ? `Kabuk çıkış kodu ${msg.code}` : 'Kabuk kapandı'));
      else if (msg.type === 'error') void this.end(session, TerminalSessionStatus.FAILED, msg.message, 'TERMINAL_AGENT_REJECTED');
    });
    socket.on('close', () => {
      if (session.status !== 'ENDED') void this.end(session, session.status === 'ACTIVE' ? TerminalSessionStatus.CLOSED : TerminalSessionStatus.FAILED, 'Ajan bağlantısı kapandı');
    });
    socket.on('error', (error: Error) => this.logger.debug(`Ajan terminal soketi hatası: ${error.message}`));
    session.backend = backend;
    return session;
  }

  private async activate(session: LiveSession, backend: TerminalBackend): Promise<void> {
    if (session.status !== 'CONNECTING') return;
    if (session.attachTimer) clearTimeout(session.attachTimer);
    session.backend = backend;
    session.status = 'ACTIVE';
    await this.prisma.terminalSession.update({ where: { id: session.id }, data: { status: TerminalSessionStatus.ACTIVE } }).catch(() => undefined);
    this.sendJson(session, { type: 'ready', sessionId: session.id, protocol: session.protocol });
    this.logger.log(`Terminal oturumu etkin: ${session.serverName} (${session.protocol}) — ${session.userEmail}`);
  }

  private onCommandResult(command: AgentCommand, ok: boolean, message?: string): void {
    if (command.type !== 'terminal.open' || ok) return;
    const sessionId = (command.payload as { sessionId?: string }).sessionId;
    const session = sessionId ? this.live.get(sessionId) : undefined;
    if (session && session.status === 'CONNECTING') void this.end(session, TerminalSessionStatus.FAILED, message || MESSAGES.TERMINAL_AGENT_REJECTED, 'TERMINAL_AGENT_REJECTED');
  }

  // ---------------------------------------------------------------------------
  // Veri akışı
  // ---------------------------------------------------------------------------

  input(session: LiveSession, data: string): void {
    if (session.status !== 'ACTIVE' || !session.backend) return;
    this.touch(session);
    session.backend.write(data);
    for (const line of session.parser.feed(data)) this.logCommand(session, line);
  }

  resize(session: LiveSession, cols: number, rows: number): void {
    const size = clampSize(cols, rows);
    session.cols = size.cols;
    session.rows = size.rows;
    session.backend?.resize(size.cols, size.rows);
  }

  private logCommand(session: LiveSession, command: string): void {
    session.commandCount += 1;
    // Yazma beklenmez (girdi akışını yavaşlatmamak için); oturum kapanırken tümü tamamlanana kadar beklenir.
    const write = this.prisma.terminalCommandLog.create({ data: { sessionId: session.id, command } }).then(
      () => undefined,
      (error: Error) => this.logger.warn(`Komut kaydı yazılamadı: ${error.message}`),
    );
    session.logWrites.push(write);
  }

  private touch(session: LiveSession): void {
    if (session.idleTimer) clearTimeout(session.idleTimer);
    session.idleTimer = setTimeout(() => void this.end(session, TerminalSessionStatus.TIMED_OUT, 'Boşta kalma süresi doldu'), TERMINAL_LIMITS.idleTimeoutMs);
  }

  private sendData(session: LiveSession, data: Buffer): void {
    if (session.browser.readyState === session.browser.OPEN) session.browser.send(data, { binary: true });
  }

  private sendJson(session: LiveSession, payload: Record<string, unknown>): void {
    if (session.browser.readyState === session.browser.OPEN) session.browser.send(JSON.stringify(payload));
  }

  // ---------------------------------------------------------------------------
  // Kapatma
  // ---------------------------------------------------------------------------

  async end(session: LiveSession, status: TerminalSessionStatus, reason: string | null, code?: MessageCode): Promise<void> {
    if (session.status === 'ENDED') return;
    session.status = 'ENDED';
    this.live.delete(session.id);
    for (const t of [session.idleTimer, session.maxTimer, session.attachTimer]) if (t) clearTimeout(t);
    const pending = session.parser.flush();
    if (pending) this.logCommand(session, pending);
    try {
      session.backend?.close();
    } catch {
      // yok say
    }
    await Promise.all(session.logWrites);
    const durationSec = Math.round((Date.now() - session.startedAt) / 1000);
    await this.prisma.terminalSession.update({ where: { id: session.id }, data: { status, endedAt: new Date(), endReason: reason?.slice(0, 500) ?? null } }).catch(() => undefined);
    await this.audit.record({ userId: session.userId, actorLabel: session.userEmail, action: 'terminal.close', resourceType: 'terminal_session', resourceId: session.id, result: status === TerminalSessionStatus.FAILED ? AuditResult.FAILURE : AuditResult.SUCCESS, metadata: { serverId: session.serverId, serverName: session.serverName, protocol: session.protocol, status, reason, commandCount: session.commandCount, durationSec } });
    this.sendJson(session, { type: 'exit', status, statusLabel: TERMINAL_STATUS_LABELS[status], reason, code: code ?? null });
    if (session.browser.readyState === session.browser.OPEN) session.browser.close(1000, 'session ended');
  }

  /** Tarayıcı soketi kapandığında çağrılır. */
  browserClosed(session: LiveSession): void {
    void this.end(session, TerminalSessionStatus.CLOSED, 'Tarayıcı bağlantıyı kapattı');
  }

  async terminate(actor: AuthenticatedUser, sessionId: string, ipAddress: string | null): Promise<void> {
    const row = await this.prisma.terminalSession.findUnique({ where: { id: sessionId } });
    if (!row) throw AppError.notFound('TERMINAL_SESSION_NOT_FOUND');
    if (row.userId !== actor.id && !actor.permissions.includes(PERMISSIONS.TERMINAL_CREDENTIALS)) throw AppError.forbidden();
    const live = this.live.get(sessionId);
    if (live) await this.end(live, TerminalSessionStatus.TERMINATED, `${actor.email} tarafından sonlandırıldı`);
    else if (row.status === TerminalSessionStatus.ACTIVE || row.status === TerminalSessionStatus.CONNECTING) {
      await this.prisma.terminalSession.update({ where: { id: sessionId }, data: { status: TerminalSessionStatus.TERMINATED, endedAt: new Date(), endReason: `${actor.email} tarafından sonlandırıldı` } });
    } else throw AppError.conflict('TERMINAL_SESSION_NOT_ACTIVE');
    await this.audit.record({ userId: actor.id, actorLabel: actor.email, action: 'terminal.terminate', resourceType: 'terminal_session', resourceId: sessionId, ipAddress, result: AuditResult.SUCCESS, metadata: { ownerId: row.userId, serverId: row.serverId } });
  }

  // ---------------------------------------------------------------------------
  // Listeleme
  // ---------------------------------------------------------------------------

  async listServers(): Promise<unknown[]> {
    const servers = await this.prisma.server.findMany({
      orderBy: { name: 'asc' },
      include: { agent: { select: { status: true } }, credentials: { select: { type: true, username: true, host: true, port: true, hostFingerprint: true, updatedAt: true }, orderBy: { updatedAt: 'desc' }, take: 1 } },
    });
    return servers.map((s) => {
      const credential = s.credentials[0] ?? null;
      const agentConnected = s.agent?.status === 'CONNECTED';
      const methods: TerminalProtocol[] = [];
      if (credential) methods.push(TerminalProtocol.SSH);
      if (agentConnected) methods.push(TerminalProtocol.AGENT);
      return { id: s.id, name: s.name, hostname: s.hostname, osFamily: s.osFamily, status: s.status, agentConnected, credential, methods, activeSessions: [...this.live.values()].filter((l) => l.serverId === s.id).length };
    });
  }

  async listSessions(actor: AuthenticatedUser, query: ListSessionsQueryDto) {
    const canAll = actor.permissions.includes(PERMISSIONS.AUDIT_READ);
    const where: Prisma.TerminalSessionWhereInput = { ...(canAll ? {} : { userId: actor.id }), ...(query.serverId ? { serverId: query.serverId } : {}) };
    const [total, rows] = await Promise.all([
      this.prisma.terminalSession.count({ where }),
      this.prisma.terminalSession.findMany({ where, orderBy: { startedAt: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize, include: { server: { select: { id: true, name: true } }, user: { select: { id: true, fullName: true, email: true } }, _count: { select: { commands: true } } } }),
    ]);
    return {
      items: rows.map((r) => ({ id: r.id, server: r.server, user: r.user, protocol: r.protocol, protocolLabel: TERMINAL_PROTOCOL_LABELS[r.protocol], status: r.status, statusLabel: TERMINAL_STATUS_LABELS[r.status], clientIp: r.clientIp, startedAt: r.startedAt, endedAt: r.endedAt, endReason: r.endReason, commandCount: r._count.commands, isLive: this.live.has(r.id) })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async listCommands(actor: AuthenticatedUser, sessionId: string) {
    const row = await this.prisma.terminalSession.findUnique({ where: { id: sessionId } });
    if (!row) throw AppError.notFound('TERMINAL_SESSION_NOT_FOUND');
    if (row.userId !== actor.id && !actor.permissions.includes(PERMISSIONS.AUDIT_READ)) throw AppError.forbidden();
    const commands = await this.prisma.terminalCommandLog.findMany({ where: { sessionId }, orderBy: { id: 'asc' }, take: 2000 });
    return commands.map((c) => ({ id: c.id.toString(), command: c.command, executedAt: c.executedAt }));
  }
}
