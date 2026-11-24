import { Injectable, Logger } from '@nestjs/common';
import { AuditResult, IncidentSeverity, IncidentStatus, IncidentType, type Incident, type Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/app-error';
import { RealtimeService } from '../realtime/realtime.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { IncidentActionDto, ListIncidentsQueryDto } from './dto/incidents.dto';

export const INCIDENT_TYPE_LABELS: Record<IncidentType, string> = {
  SERVER_UNAVAILABLE: 'Sunucu erişilemiyor',
  AGENT_DISCONNECTED: 'Ajan bağlantısı kesildi',
  SERVICE_FAILURE: 'Hizmet durdu',
  HIGH_CPU: 'Yüksek CPU kullanımı',
  HIGH_MEMORY: 'Yüksek bellek kullanımı',
  LOW_DISK: 'Düşük disk alanı',
  NETWORK_FAILURE: 'Ağ hatası',
  SSL_EXPIRING: 'SSL sertifikası süresi doluyor',
  CHECK_DOWN: 'Erişilebilirlik kontrolü başarısız',
};

export const INCIDENT_SEVERITY_LABELS: Record<IncidentSeverity, string> = {
  INFO: 'Bilgi',
  WARNING: 'Uyarı',
  CRITICAL: 'Kritik',
};

export interface IncidentTarget {
  serverId?: string | null;
  checkId?: string | null;
  serviceId?: string | null;
}

export interface OpenIncidentInput extends IncidentTarget {
  type: IncidentType;
  severity: IncidentSeverity;
  title: string;
  description?: string;
  /** Olay oluşturulurken bildirim verileri için ek bağlam (ör. sunucu adı). */
  context?: Record<string, unknown>;
}

const ACTIVE: IncidentStatus[] = [IncidentStatus.OPEN, IncidentStatus.ACKNOWLEDGED];

/**
 * Olay yaşam döngüsü: tespit → (doğrulama çağıran tarafta) → oluşturma → bildirim → toparlanma → çözüm.
 * Aynı tür ve hedef için yalnızca bir etkin olay bulunur (tekilleştirme).
 */
@Injectable()
export class IncidentsService {
  private readonly logger = new Logger(IncidentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationsService,
  ) {}

  private targetWhere(type: IncidentType, target: IncidentTarget): Prisma.IncidentWhereInput {
    return {
      type,
      status: { in: ACTIVE },
      serverId: target.serverId ?? null,
      checkId: target.checkId ?? null,
      serviceId: target.serviceId ?? null,
    };
  }

  /** Etkin bir olay yoksa yeni olay açar; varsa açıklamayı günceller ve mevcut olayı döndürür. */
  async open(input: OpenIncidentInput): Promise<{ incident: Incident; created: boolean }> {
    const existing = await this.prisma.incident.findFirst({ where: this.targetWhere(input.type, input) });
    if (existing) {
      if (input.description && input.description !== existing.description) {
        const updated = await this.prisma.incident.update({ where: { id: existing.id }, data: { description: input.description } });
        return { incident: updated, created: false };
      }
      return { incident: existing, created: false };
    }

    const incident = await this.prisma.incident.create({
      data: {
        type: input.type,
        severity: input.severity,
        title: input.title,
        description: input.description,
        serverId: input.serverId ?? null,
        checkId: input.checkId ?? null,
        serviceId: input.serviceId ?? null,
        events: { create: { kind: 'CREATED', message: `Olay açıldı: ${input.title}` } },
      },
    });
    this.logger.warn(`Olay açıldı [${input.severity}] ${input.title}`);
    await this.audit.record({
      actorLabel: 'sistem',
      action: 'incident.create',
      resourceType: 'incident',
      resourceId: incident.id,
      result: AuditResult.SUCCESS,
      metadata: { type: input.type, severity: input.severity, serverId: input.serverId, checkId: input.checkId },
    });
    this.realtime.emit('incident.created', { incidentId: incident.id, type: incident.type, severity: incident.severity, serverId: incident.serverId });
    await this.notifications.dispatch(input.type, { incident, context: input.context ?? {} });
    return { incident, created: true };
  }

  /** Belirtilen tür ve hedefe ait etkin olayı sistem adına çözer (toparlanma). */
  async resolveAuto(type: IncidentType, target: IncidentTarget, note: string, context: Record<string, unknown> = {}): Promise<Incident | null> {
    const existing = await this.prisma.incident.findFirst({ where: this.targetWhere(type, target) });
    if (!existing) return null;
    const incident = await this.prisma.incident.update({
      where: { id: existing.id },
      data: {
        status: IncidentStatus.RESOLVED,
        resolvedAt: new Date(),
        resolutionNote: note,
        events: { create: { kind: 'RESOLVED', message: note } },
      },
    });
    this.logger.log(`Olay çözüldü: ${incident.title}`);
    await this.audit.record({ actorLabel: 'sistem', action: 'incident.resolve', resourceType: 'incident', resourceId: incident.id, result: AuditResult.SUCCESS, metadata: { auto: true, note } });
    this.realtime.emit('incident.updated', { incidentId: incident.id, status: incident.status, serverId: incident.serverId });
    await this.notifications.dispatchRecovery(type, { incident, context });
    return incident;
  }

  async acknowledge(actor: AuthenticatedUser, id: string, dto: IncidentActionDto, ipAddress: string | null) {
    const incident = await this.prisma.incident.findUnique({ where: { id } });
    if (!incident) throw AppError.notFound('INCIDENT_NOT_FOUND');
    if (incident.status !== IncidentStatus.OPEN) throw AppError.conflict('INCIDENT_NOT_OPEN');
    const message = dto.note ? `${actor.fullName} olayı üstlendi: ${dto.note}` : `${actor.fullName} olayı üstlendi`;
    await this.prisma.incident.update({
      where: { id },
      data: {
        status: IncidentStatus.ACKNOWLEDGED,
        acknowledgedAt: new Date(),
        acknowledgedById: actor.id,
        events: { create: { kind: 'ACKNOWLEDGED', message, userId: actor.id } },
      },
    });
    await this.audit.record({ userId: actor.id, actorLabel: actor.email, action: 'incident.acknowledge', resourceType: 'incident', resourceId: id, ipAddress, result: AuditResult.SUCCESS, metadata: { note: dto.note } });
    this.realtime.emit('incident.updated', { incidentId: id, status: IncidentStatus.ACKNOWLEDGED, serverId: incident.serverId });
    return this.getById(id);
  }

  async resolveManual(actor: AuthenticatedUser, id: string, dto: IncidentActionDto, ipAddress: string | null) {
    const incident = await this.prisma.incident.findUnique({ where: { id } });
    if (!incident) throw AppError.notFound('INCIDENT_NOT_FOUND');
    if (incident.status === IncidentStatus.RESOLVED) throw AppError.conflict('INCIDENT_ALREADY_RESOLVED');
    const note = dto.note ? `${actor.fullName} olayı çözdü: ${dto.note}` : `${actor.fullName} olayı elle çözdü`;
    await this.prisma.incident.update({
      where: { id },
      data: {
        status: IncidentStatus.RESOLVED,
        resolvedAt: new Date(),
        resolvedById: actor.id,
        resolutionNote: dto.note ?? 'Elle çözüldü',
        events: { create: { kind: 'RESOLVED', message: note, userId: actor.id } },
      },
    });
    await this.audit.record({ userId: actor.id, actorLabel: actor.email, action: 'incident.resolve', resourceType: 'incident', resourceId: id, ipAddress, result: AuditResult.SUCCESS, metadata: { auto: false, note: dto.note } });
    this.realtime.emit('incident.updated', { incidentId: id, status: IncidentStatus.RESOLVED, serverId: incident.serverId });
    return this.getById(id);
  }

  async addNote(actor: AuthenticatedUser, id: string, dto: IncidentActionDto, ipAddress: string | null) {
    const incident = await this.prisma.incident.findUnique({ where: { id } });
    if (!incident) throw AppError.notFound('INCIDENT_NOT_FOUND');
    if (!dto.note) throw AppError.badRequest('VALIDATION_FAILED', ['Not boş olamaz.']);
    await this.prisma.incidentEvent.create({ data: { incidentId: id, kind: 'NOTE', message: dto.note, userId: actor.id } });
    await this.audit.record({ userId: actor.id, actorLabel: actor.email, action: 'incident.note', resourceType: 'incident', resourceId: id, ipAddress, result: AuditResult.SUCCESS });
    this.realtime.emit('incident.updated', { incidentId: id, status: incident.status, serverId: incident.serverId });
    return this.getById(id);
  }

  async list(query: ListIncidentsQueryDto) {
    const where: Prisma.IncidentWhereInput = {
      ...(query.status === 'active' ? { status: { in: ACTIVE } } : query.status ? { status: query.status } : {}),
      ...(query.severity ? { severity: query.severity } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.serverId ? { serverId: query.serverId } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.incident.findMany({
        where,
        include: { server: { select: { id: true, name: true } }, check: { select: { id: true, name: true } }, acknowledgedBy: { select: { fullName: true } }, resolvedBy: { select: { fullName: true } } },
        orderBy: [{ startedAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.incident.count({ where }),
    ]);
    return { items: items.map((i) => this.toView(i)), total, page: query.page, pageSize: query.pageSize };
  }

  async getById(id: string) {
    const incident = await this.prisma.incident.findUnique({
      where: { id },
      include: {
        server: { select: { id: true, name: true } },
        check: { select: { id: true, name: true } },
        acknowledgedBy: { select: { fullName: true } },
        resolvedBy: { select: { fullName: true } },
        events: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], include: { user: { select: { fullName: true } } } },
        notifications: { include: { channel: { select: { name: true, type: true } } }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!incident) throw AppError.notFound('INCIDENT_NOT_FOUND');
    return {
      ...this.toView(incident),
      events: incident.events.map((e) => ({ id: e.id.toString(), kind: e.kind, message: e.message, userName: e.user?.fullName ?? null, createdAt: e.createdAt })),
      notifications: incident.notifications.map((n) => ({ id: n.id, channelName: n.channel.name, channelType: n.channel.type, eventType: n.eventType, status: n.status, attempts: n.attempts, lastError: n.lastError, sentAt: n.sentAt })),
    };
  }

  async activeCount(): Promise<number> {
    return this.prisma.incident.count({ where: { status: { in: ACTIVE } } });
  }

  private toView(i: Incident & { server?: { id: string; name: string } | null; check?: { id: string; name: string } | null; acknowledgedBy?: { fullName: string } | null; resolvedBy?: { fullName: string } | null }) {
    const end = i.resolvedAt ?? new Date();
    return {
      id: i.id,
      type: i.type,
      typeLabel: INCIDENT_TYPE_LABELS[i.type],
      severity: i.severity,
      severityLabel: INCIDENT_SEVERITY_LABELS[i.severity],
      status: i.status,
      title: i.title,
      description: i.description,
      server: i.server ?? null,
      check: i.check ?? null,
      startedAt: i.startedAt,
      acknowledgedAt: i.acknowledgedAt,
      acknowledgedBy: i.acknowledgedBy?.fullName ?? null,
      resolvedAt: i.resolvedAt,
      resolvedBy: i.resolvedBy?.fullName ?? null,
      resolutionNote: i.resolutionNote,
      durationSeconds: Math.max(0, Math.round((end.getTime() - i.startedAt.getTime()) / 1000)),
      updatedAt: i.updatedAt,
    };
  }
}
