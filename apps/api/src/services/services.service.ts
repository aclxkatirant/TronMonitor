import { Injectable, Logger } from '@nestjs/common';
import { AuditResult, CommandStatus, IncidentSeverity, IncidentType, Prisma, ServiceState, type AgentCommand, type MonitoredService } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/app-error';
import { RealtimeService } from '../realtime/realtime.service';
import { IncidentsService } from '../incidents/incidents.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { AuthenticatedAgent } from '../agents/agent-auth.guard';
import type { CommandResultDto, ListCommandsQueryDto, ListServicesQueryDto, ServiceAction, ServiceReportDto } from './dto/services.dto';

const COMMAND_TTL_MS = 10 * 60_000;
const FAILED_STATES: ServiceState[] = [ServiceState.STOPPED, ServiceState.FAILED];

export const SERVICE_STATE_LABELS: Record<ServiceState, string> = {
  RUNNING: 'Çalışıyor',
  STOPPED: 'Durduruldu',
  STARTING: 'Başlatılıyor',
  STOPPING: 'Durduruluyor',
  FAILED: 'Başarısız',
  UNKNOWN: 'Bilinmiyor',
};

const ACTION_LABELS: Record<ServiceAction, string> = { start: 'başlatma', stop: 'durdurma', restart: 'yeniden başlatma' };

@Injectable()
export class ServicesService {
  private readonly logger = new Logger(ServicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly incidents: IncidentsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Ajan raporu
  // ---------------------------------------------------------------------------

  /**
   * Ajanın hizmet listesini işler: yeni hizmetler eklenir, durum değişiklikleri olay olarak kaydedilir,
   * izlenen hizmetler durunca SERVICE_FAILURE olayı açılır ve toparlanınca çözülür. Artık bildirilmeyen
   * hizmetler silinmez; yalnızca lastSeenAt güncellenmez (kaldırılmış olabilir).
   */
  async applyReport(agent: AuthenticatedAgent, dto: ServiceReportDto): Promise<{ accepted: number; changed: number }> {
    const server = await this.prisma.server.findUnique({ where: { id: agent.serverId }, select: { id: true, name: true } });
    if (!server) throw AppError.unauthorized('AGENT_AUTH_INVALID');
    const existing = await this.prisma.monitoredService.findMany({ where: { serverId: server.id } });
    const byName = new Map(existing.map((s) => [s.name, s]));
    const now = new Date();
    const seen = new Set<string>();
    let changed = 0;

    const creates: Prisma.MonitoredServiceCreateManyInput[] = [];
    const transitions: { service: MonitoredService; to: ServiceState }[] = [];
    const touched: { id: string; data: Prisma.MonitoredServiceUpdateInput }[] = [];

    for (const item of dto.services) {
      if (seen.has(item.name)) continue;
      seen.add(item.name);
      const current = byName.get(item.name);
      if (!current) {
        creates.push({ serverId: server.id, name: item.name, displayName: item.displayName ?? null, state: item.state, startupType: item.startupType ?? null, isEnabled: item.isEnabled ?? null, lastSeenAt: now, lastStateChangeAt: now });
        continue;
      }
      const data: Prisma.MonitoredServiceUpdateInput = { lastSeenAt: now };
      if (current.displayName !== (item.displayName ?? null)) data.displayName = item.displayName ?? null;
      if (current.startupType !== (item.startupType ?? null)) data.startupType = item.startupType ?? null;
      if (current.isEnabled !== (item.isEnabled ?? null)) data.isEnabled = item.isEnabled ?? null;
      if (current.state !== item.state) {
        data.state = item.state;
        data.lastStateChangeAt = now;
        transitions.push({ service: current, to: item.state });
        changed += 1;
      }
      touched.push({ id: current.id, data });
    }

    await this.prisma.$transaction(async (tx) => {
      if (creates.length > 0) await tx.monitoredService.createMany({ data: creates, skipDuplicates: true });
      for (const t of touched) await tx.monitoredService.update({ where: { id: t.id }, data: t.data });
      if (transitions.length > 0) {
        await tx.serviceStateEvent.createMany({ data: transitions.map((t) => ({ serviceId: t.service.id, fromState: t.service.state, toState: t.to })) });
      }
    });

    for (const t of transitions) {
      if (!t.service.isMonitored) continue;
      const context = { serverName: server.name, serviceName: t.service.displayName || t.service.name };
      if (FAILED_STATES.includes(t.to)) {
        await this.incidents.open({
          type: IncidentType.SERVICE_FAILURE,
          severity: IncidentSeverity.CRITICAL,
          title: `Hizmet durdu: ${t.service.displayName || t.service.name} (${server.name})`,
          description: `${t.service.name} hizmeti ${SERVICE_STATE_LABELS[t.service.state].toLocaleLowerCase('tr-TR')} durumundan ${SERVICE_STATE_LABELS[t.to].toLocaleLowerCase('tr-TR')} durumuna geçti.`,
          serverId: server.id,
          serviceId: t.service.id,
          context,
        });
      } else if (t.to === ServiceState.RUNNING) {
        await this.incidents.resolveAuto(IncidentType.SERVICE_FAILURE, { serverId: server.id, serviceId: t.service.id }, 'Hizmet yeniden çalışıyor', context);
      }
    }
    if (changed > 0 || creates.length > 0) this.realtime.emit('services.updated', { serverId: server.id, changed, added: creates.length });
    return { accepted: seen.size, changed };
  }

  // ---------------------------------------------------------------------------
  // Listeleme ve izleme seçimi
  // ---------------------------------------------------------------------------

  async listForServer(serverId: string, query: ListServicesQueryDto) {
    const exists = await this.prisma.server.count({ where: { id: serverId } });
    if (!exists) throw AppError.notFound('SERVER_NOT_FOUND');
    const where: Prisma.MonitoredServiceWhereInput = {
      serverId,
      ...(query.monitored !== undefined ? { isMonitored: query.monitored } : {}),
      ...(query.state ? { state: query.state } : {}),
      ...(query.search ? { OR: [{ name: { contains: query.search, mode: 'insensitive' } }, { displayName: { contains: query.search, mode: 'insensitive' } }] } : {}),
    };
    const [items, total, counts] = await Promise.all([
      this.prisma.monitoredService.findMany({ where, orderBy: [{ isMonitored: 'desc' }, { name: 'asc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.monitoredService.count({ where }),
      this.prisma.monitoredService.groupBy({ by: ['state'], where: { serverId }, _count: { _all: true } }),
    ]);
    return {
      items: items.map((s) => this.toView(s)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      summary: Object.fromEntries(counts.map((c) => [c.state, c._count._all])) as Partial<Record<ServiceState, number>>,
    };
  }

  /** Tüm sunuculardaki izlenen hizmetler (Hizmetler sayfası özeti). */
  async listMonitored() {
    const items = await this.prisma.monitoredService.findMany({
      where: { isMonitored: true },
      include: { server: { select: { id: true, name: true, status: true } } },
      orderBy: [{ state: 'asc' }, { name: 'asc' }],
    });
    return items.map((s) => ({ ...this.toView(s), server: s.server }));
  }

  async setMonitored(actor: AuthenticatedUser, serverId: string, serviceId: string, isMonitored: boolean, ipAddress: string | null) {
    const service = await this.prisma.monitoredService.findFirst({ where: { id: serviceId, serverId } });
    if (!service) throw AppError.notFound('SERVICE_NOT_FOUND');
    const updated = await this.prisma.monitoredService.update({ where: { id: serviceId }, data: { isMonitored } });
    if (!isMonitored) {
      await this.incidents.resolveAuto(IncidentType.SERVICE_FAILURE, { serverId, serviceId }, 'Hizmet izlemeden çıkarıldı');
    }
    await this.audit.record({ userId: actor.id, actorLabel: actor.email, action: isMonitored ? 'service.monitor' : 'service.unmonitor', resourceType: 'service', resourceId: serviceId, ipAddress, result: AuditResult.SUCCESS, metadata: { serverId, name: service.name } });
    this.realtime.emit('services.updated', { serverId });
    return this.toView(updated);
  }

  async events(serverId: string, serviceId: string) {
    const service = await this.prisma.monitoredService.findFirst({ where: { id: serviceId, serverId } });
    if (!service) throw AppError.notFound('SERVICE_NOT_FOUND');
    const rows = await this.prisma.serviceStateEvent.findMany({ where: { serviceId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 50 });
    return rows.map((e) => ({ id: e.id.toString(), fromState: e.fromState, toState: e.toState, createdAt: e.createdAt }));
  }

  // ---------------------------------------------------------------------------
  // Hizmet kontrolü (ajana komut)
  // ---------------------------------------------------------------------------

  async requestControl(actor: AuthenticatedUser, serverId: string, serviceId: string, action: ServiceAction, ipAddress: string | null) {
    const service = await this.prisma.monitoredService.findFirst({ where: { id: serviceId, serverId }, include: { server: { include: { agent: true } } } });
    if (!service) throw AppError.notFound('SERVICE_NOT_FOUND');
    const agent = service.server.agent;
    if (!agent) throw AppError.notFound('AGENT_NOT_FOUND');
    if (agent.status !== 'CONNECTED') throw AppError.conflict('AGENT_NOT_CONNECTED');
    const pending = await this.prisma.agentCommand.count({ where: { agentId: agent.id, status: { in: [CommandStatus.PENDING, CommandStatus.SENT] }, payload: { path: ['serviceName'], equals: service.name } } });
    if (pending > 0) throw AppError.conflict('COMMAND_ALREADY_PENDING');

    const command = await this.prisma.agentCommand.create({
      data: {
        agentId: agent.id,
        type: `service.${action}`,
        payload: { serviceName: service.name, serviceId: service.id },
        requestedById: actor.id,
        expiresAt: new Date(Date.now() + COMMAND_TTL_MS),
      },
    });
    await this.audit.record({ userId: actor.id, actorLabel: actor.email, action: `service.${action}`, resourceType: 'service', resourceId: serviceId, ipAddress, result: AuditResult.SUCCESS, metadata: { serverId, serverName: service.server.name, name: service.name, commandId: command.id } });
    this.logger.log(`Hizmet ${ACTION_LABELS[action]} komutu kuyruğa alındı: ${service.name} @ ${service.server.name} (${actor.email})`);
    return this.toCommandView(command);
  }

  /** Heartbeat yanıtına eklenecek bekleyen komutlar; gönderildi olarak işaretlenir. */
  async takePendingCommands(agentId: string): Promise<{ id: string; type: string; payload: Record<string, string> }[]> {
    const now = new Date();
    await this.prisma.agentCommand.updateMany({ where: { agentId, status: { in: [CommandStatus.PENDING, CommandStatus.SENT] }, expiresAt: { lt: now } }, data: { status: CommandStatus.EXPIRED, completedAt: now, result: 'Ajan komutu zamanında almadı' } });
    const pending = await this.prisma.agentCommand.findMany({ where: { agentId, status: CommandStatus.PENDING }, orderBy: { createdAt: 'asc' }, take: 10 });
    if (pending.length === 0) return [];
    await this.prisma.agentCommand.updateMany({ where: { id: { in: pending.map((c) => c.id) } }, data: { status: CommandStatus.SENT, sentAt: now } });
    return pending.map((c) => ({ id: c.id, type: c.type, payload: c.payload as Record<string, string> }));
  }

  async completeCommand(agent: AuthenticatedAgent, commandId: string, dto: CommandResultDto): Promise<void> {
    const command = await this.prisma.agentCommand.findFirst({ where: { id: commandId, agentId: agent.agentId } });
    if (!command) throw AppError.notFound('COMMAND_NOT_FOUND');
    if (command.status === CommandStatus.SUCCEEDED || command.status === CommandStatus.FAILED) return;
    await this.prisma.agentCommand.update({
      where: { id: commandId },
      data: { status: dto.ok ? CommandStatus.SUCCEEDED : CommandStatus.FAILED, result: dto.message?.slice(0, 2000) ?? null, completedAt: new Date() },
    });
    await this.audit.record({ userId: command.requestedById, actorLabel: `agent:${agent.keyId.slice(0, 12)}`, action: 'service.command_result', resourceType: 'agent_command', resourceId: commandId, result: dto.ok ? AuditResult.SUCCESS : AuditResult.FAILURE, metadata: { type: command.type, message: dto.message } });
    this.realtime.emit('services.updated', { serverId: agent.serverId, commandId, ok: dto.ok });
  }

  async listCommands(query: ListCommandsQueryDto) {
    const rows = await this.prisma.agentCommand.findMany({
      where: query.serverId ? { agent: { serverId: query.serverId } } : {},
      include: { requestedBy: { select: { fullName: true } }, agent: { select: { server: { select: { id: true, name: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
    });
    return rows.map((c) => ({ ...this.toCommandView(c), requestedBy: c.requestedBy?.fullName ?? null, server: c.agent.server }));
  }

  private toView(s: MonitoredService) {
    return {
      id: s.id,
      serverId: s.serverId,
      name: s.name,
      displayName: s.displayName,
      state: s.state,
      stateLabel: SERVICE_STATE_LABELS[s.state],
      startupType: s.startupType,
      isEnabled: s.isEnabled,
      isMonitored: s.isMonitored,
      lastStateChangeAt: s.lastStateChangeAt,
      lastSeenAt: s.lastSeenAt,
    };
  }

  private toCommandView(c: AgentCommand) {
    return { id: c.id, type: c.type, payload: c.payload as Record<string, string>, status: c.status, result: c.result, createdAt: c.createdAt, sentAt: c.sentAt, completedAt: c.completedAt, expiresAt: c.expiresAt };
  }
}
