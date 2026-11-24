import { Injectable, Logger } from '@nestjs/common';
import { AuditResult, CheckStatus, CheckType, IncidentSeverity, IncidentType, Prisma, type MonitoringCheck } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/app-error';
import { RealtimeService } from '../realtime/realtime.service';
import { IncidentsService } from '../incidents/incidents.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { MetricsQueryDto } from '../metrics/dto/metrics.dto';
import { runCheck, validateTarget, type CheckOutcome } from './check-runner';
import type { CreateCheckDto, ListChecksQueryDto, ResultsQueryDto, UpdateCheckDto } from './dto/uptime.dto';

const CONCURRENCY = 8;
const MAX_POINTS = 360;
const NICE_BUCKETS_SEC = [60, 120, 300, 600, 900, 1800, 3600, 7200, 21600, 43200, 86400];
const RANGE_MS: Record<string, number> = { '1h': 3_600_000, '6h': 6 * 3_600_000, '24h': 24 * 3_600_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000 };

export const CHECK_TYPE_LABELS: Record<CheckType, string> = { HTTP: 'HTTP', HTTPS: 'HTTPS', TCP: 'TCP portu', ICMP: 'ICMP (ping)' };

interface UptimeRow {
  checkId: string;
  total: bigint;
  up: bigint;
}

@Injectable()
export class UptimeService {
  private readonly logger = new Logger(UptimeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly incidents: IncidentsService,
  ) {}

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  private async assertTarget(type: CheckType, target: string, port: number | null, serverId?: string | null): Promise<void> {
    const problem = validateTarget(type, target, port);
    if (problem) throw AppError.badRequest('VALIDATION_FAILED', [problem]);
    if (serverId) {
      const exists = await this.prisma.server.count({ where: { id: serverId } });
      if (!exists) throw AppError.notFound('SERVER_NOT_FOUND');
    }
  }

  async create(actor: AuthenticatedUser, dto: CreateCheckDto, ipAddress: string | null) {
    await this.assertTarget(dto.type, dto.target, dto.port ?? null, dto.serverId);
    const check = await this.prisma.monitoringCheck.create({
      data: {
        name: dto.name,
        type: dto.type,
        target: dto.target,
        port: dto.type === CheckType.TCP ? dto.port : null,
        method: dto.type === CheckType.HTTP || dto.type === CheckType.HTTPS ? (dto.method ?? 'GET') : null,
        expectedStatusCode: dto.expectedStatusCode ?? null,
        intervalSec: dto.intervalSec ?? 60,
        timeoutSec: dto.timeoutSec ?? 10,
        retryCount: dto.retryCount ?? 2,
        failureThreshold: dto.failureThreshold ?? 3,
        recoveryThreshold: dto.recoveryThreshold ?? 2,
        sslExpiryWarnDays: dto.type === CheckType.HTTPS ? (dto.sslExpiryWarnDays ?? 14) : null,
        notifyOnFailure: dto.notifyOnFailure ?? true,
        isEnabled: dto.isEnabled ?? true,
        serverId: dto.serverId ?? null,
        createdById: actor.id,
      },
    });
    await this.audit.record({ userId: actor.id, actorLabel: actor.email, action: 'check.create', resourceType: 'check', resourceId: check.id, ipAddress, result: AuditResult.SUCCESS, metadata: { name: check.name, type: check.type, target: check.target } });
    this.realtime.emit('check.status', { checkId: check.id, status: check.status });
    return this.toView(check, null);
  }

  async update(actor: AuthenticatedUser, id: string, dto: UpdateCheckDto, ipAddress: string | null) {
    const existing = await this.prisma.monitoringCheck.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound('CHECK_NOT_FOUND');
    const type = dto.type ?? existing.type;
    const target = dto.target ?? existing.target;
    const port = dto.port ?? existing.port;
    await this.assertTarget(type, target, port, dto.serverId);
    const check = await this.prisma.monitoringCheck.update({
      where: { id },
      data: {
        name: dto.name,
        type,
        target,
        port: type === CheckType.TCP ? port : null,
        method: type === CheckType.HTTP || type === CheckType.HTTPS ? (dto.method ?? existing.method ?? 'GET') : null,
        expectedStatusCode: dto.expectedStatusCode,
        intervalSec: dto.intervalSec,
        timeoutSec: dto.timeoutSec,
        retryCount: dto.retryCount,
        failureThreshold: dto.failureThreshold,
        recoveryThreshold: dto.recoveryThreshold,
        sslExpiryWarnDays: type === CheckType.HTTPS ? dto.sslExpiryWarnDays : null,
        notifyOnFailure: dto.notifyOnFailure,
        isEnabled: dto.isEnabled,
        serverId: dto.serverId === undefined ? undefined : dto.serverId,
        // Hedef veya tür değişirse sayaçlar sıfırlanır.
        ...(dto.target !== undefined || dto.type !== undefined ? { consecutiveFails: 0, consecutiveOks: 0 } : {}),
      },
    });
    if (dto.isEnabled === false) {
      await this.incidents.resolveAuto(IncidentType.CHECK_DOWN, { checkId: id }, 'Kontrol devre dışı bırakıldı', { checkName: check.name });
      await this.incidents.resolveAuto(IncidentType.SSL_EXPIRING, { checkId: id }, 'Kontrol devre dışı bırakıldı', { checkName: check.name });
    }
    await this.audit.record({ userId: actor.id, actorLabel: actor.email, action: 'check.update', resourceType: 'check', resourceId: id, ipAddress, result: AuditResult.SUCCESS, metadata: { changes: dto } });
    this.realtime.emit('check.status', { checkId: id, status: check.status });
    return this.getById(id);
  }

  async remove(actor: AuthenticatedUser, id: string, ipAddress: string | null): Promise<void> {
    const check = await this.prisma.monitoringCheck.findUnique({ where: { id } });
    if (!check) throw AppError.notFound('CHECK_NOT_FOUND');
    await this.prisma.monitoringCheck.delete({ where: { id } });
    await this.audit.record({ userId: actor.id, actorLabel: actor.email, action: 'check.delete', resourceType: 'check', resourceId: id, ipAddress, result: AuditResult.SUCCESS, metadata: { name: check.name } });
    this.realtime.emit('check.status', { checkId: id, deleted: true });
  }

  async list(query: ListChecksQueryDto) {
    const checks = await this.prisma.monitoringCheck.findMany({
      where: { ...(query.serverId ? { serverId: query.serverId } : {}), ...(query.type ? { type: query.type } : {}) },
      include: { server: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    });
    const uptime = await this.uptimeByCheck(checks.map((c) => c.id), 24 * 3_600_000);
    return checks.map((c) => this.toView(c, uptime.get(c.id) ?? null));
  }

  async getById(id: string) {
    const check = await this.prisma.monitoringCheck.findUnique({ where: { id }, include: { server: { select: { id: true, name: true } } } });
    if (!check) throw AppError.notFound('CHECK_NOT_FOUND');
    const [u24, u7, u30] = await Promise.all([this.uptimeByCheck([id], 24 * 3_600_000), this.uptimeByCheck([id], 7 * 86_400_000), this.uptimeByCheck([id], 30 * 86_400_000)]);
    const activeIncidents = await this.prisma.incident.findMany({ where: { checkId: id, status: { not: 'RESOLVED' } }, select: { id: true, type: true, severity: true, title: true, startedAt: true } });
    return { ...this.toView(check, u24.get(id) ?? null), uptime7d: u7.get(id) ?? null, uptime30d: u30.get(id) ?? null, activeIncidents };
  }

  async results(id: string, query: ResultsQueryDto) {
    const exists = await this.prisma.monitoringCheck.count({ where: { id } });
    if (!exists) throw AppError.notFound('CHECK_NOT_FOUND');
    const rows = await this.prisma.checkResult.findMany({ where: { checkId: id }, orderBy: { checkedAt: 'desc' }, take: query.limit });
    return rows.map((r) => ({ id: r.id.toString(), checkedAt: r.checkedAt, isUp: r.isUp, responseTimeMs: r.responseTimeMs, statusCode: r.statusCode, errorMessage: r.errorMessage, sslExpiresAt: r.sslExpiresAt }));
  }

  /** Zaman aralığına göre yanıt süresi ve erişilebilirlik yüzdesi geçmişi. */
  async history(id: string, query: MetricsQueryDto) {
    const exists = await this.prisma.monitoringCheck.count({ where: { id } });
    if (!exists) throw AppError.notFound('CHECK_NOT_FOUND');
    const now = new Date();
    let from: Date;
    let to: Date;
    if (query.range === 'custom') {
      if (!query.from || !query.to) throw AppError.badRequest('VALIDATION_FAILED', ['Özel aralık için başlangıç ve bitiş tarihleri gereklidir.']);
      from = new Date(query.from);
      to = new Date(query.to);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) throw AppError.badRequest('VALIDATION_FAILED', ['Bitiş tarihi başlangıçtan sonra olmalıdır.']);
    } else {
      to = now;
      from = new Date(now.getTime() - RANGE_MS[query.range]);
    }
    const rangeSec = (to.getTime() - from.getTime()) / 1000;
    const target = Math.ceil(rangeSec / MAX_POINTS);
    const bucketSeconds = NICE_BUCKETS_SEC.find((b) => b >= target) ?? 86400;
    const rows = await this.prisma.$queryRaw<{ bucket: Date; avg_ms: number | null; max_ms: number | null; total: bigint; up: bigint }[]>`
      SELECT date_bin(make_interval(secs => ${bucketSeconds}), "checkedAt", TIMESTAMP '2000-01-01') AS bucket,
             avg("responseTimeMs") AS avg_ms, max("responseTimeMs") AS max_ms, count(*) AS total, count(*) FILTER (WHERE "isUp") AS up
      FROM "CheckResult"
      WHERE "checkId" = ${id} AND "checkedAt" >= ${from} AND "checkedAt" < ${to}
      GROUP BY bucket ORDER BY bucket`;
    return {
      range: { from, to, bucketSeconds },
      points: rows.map((r) => ({
        t: r.bucket.toISOString(),
        avgMs: r.avg_ms === null ? null : Math.round(Number(r.avg_ms)),
        maxMs: r.max_ms === null ? null : Math.round(Number(r.max_ms)),
        availability: Number(r.total) > 0 ? Math.round((Number(r.up) / Number(r.total)) * 1000) / 10 : null,
        samples: Number(r.total),
      })),
    };
  }

  async uptimeByCheck(checkIds: string[], windowMs: number): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (checkIds.length === 0) return result;
    const since = new Date(Date.now() - windowMs);
    const rows = await this.prisma.$queryRaw<UptimeRow[]>`
      SELECT "checkId", count(*) AS total, count(*) FILTER (WHERE "isUp") AS up
      FROM "CheckResult"
      WHERE "checkId" IN (${Prisma.join(checkIds)}) AND "checkedAt" >= ${since}
      GROUP BY "checkId"`;
    for (const row of rows) {
      if (Number(row.total) > 0) result.set(row.checkId, Math.round((Number(row.up) / Number(row.total)) * 1000) / 10);
    }
    return result;
  }

  /** Pano için: etkin kontrollerin son 24 saatteki genel erişilebilirliği. */
  async overallUptime24h(): Promise<{ percent: number | null; checks: number; down: number }> {
    const [agg, counts] = await Promise.all([
      this.prisma.$queryRaw<{ total: bigint; up: bigint }[]>`
        SELECT count(*) AS total, count(*) FILTER (WHERE r."isUp") AS up
        FROM "CheckResult" r JOIN "MonitoringCheck" c ON c."id" = r."checkId"
        WHERE c."isEnabled" AND r."checkedAt" >= ${new Date(Date.now() - 24 * 3_600_000)}`,
      this.prisma.monitoringCheck.groupBy({ by: ['status'], where: { isEnabled: true }, _count: { _all: true } }),
    ]);
    const total = Number(agg[0]?.total ?? 0);
    const up = Number(agg[0]?.up ?? 0);
    return {
      percent: total > 0 ? Math.round((up / total) * 1000) / 10 : null,
      checks: counts.reduce((sum, c) => sum + c._count._all, 0),
      down: counts.find((c) => c.status === CheckStatus.DOWN)?._count._all ?? 0,
    };
  }

  // ---------------------------------------------------------------------------
  // Çalıştırma
  // ---------------------------------------------------------------------------

  /** Süresi gelen kontrolleri sınırlı eşzamanlılıkla çalıştırır. Zamanlayıcı her 10 saniyede bir çağırır. */
  async runDueChecks(now = new Date()): Promise<{ executed: number }> {
    const due = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "MonitoringCheck"
      WHERE "isEnabled" AND ("lastCheckedAt" IS NULL OR "lastCheckedAt" <= ${now}::timestamp - make_interval(secs => "intervalSec"))
      ORDER BY "lastCheckedAt" NULLS FIRST
      LIMIT 200`;
    if (due.length === 0) return { executed: 0 };
    // Aynı çalıştırmada iki kez seçilmesin diye önce talep edilir.
    const claimed = await this.prisma.monitoringCheck.updateMany({ where: { id: { in: due.map((d) => d.id) } }, data: { lastCheckedAt: now } });
    const queue = [...due];
    let executed = 0;
    const worker = async () => {
      for (;;) {
        const next = queue.shift();
        if (!next) return;
        try {
          await this.execute(next.id);
          executed += 1;
        } catch (error) {
          this.logger.error(`Kontrol çalıştırılamadı (${next.id}): ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, due.length) }, worker));
    return { executed: Math.min(executed, claimed.count) };
  }

  /** Tek bir kontrolü çalıştırır, sonucu kaydeder ve durum geçişlerini/olayları işler. */
  async execute(checkId: string): Promise<CheckOutcome | null> {
    const check = await this.prisma.monitoringCheck.findUnique({ where: { id: checkId }, include: { server: { select: { name: true } } } });
    if (!check || !check.isEnabled) return null;
    const outcome = await runCheck(check);
    await this.recordOutcome(check, outcome);
    return outcome;
  }

  async recordOutcome(check: MonitoringCheck & { server?: { name: string } | null }, outcome: CheckOutcome, at = new Date()): Promise<void> {
    await this.prisma.checkResult.create({
      data: { checkId: check.id, checkedAt: at, isUp: outcome.isUp, responseTimeMs: outcome.responseTimeMs, statusCode: outcome.statusCode, errorMessage: outcome.errorMessage, sslExpiresAt: outcome.sslExpiresAt },
    });

    let status = check.status;
    let fails = check.consecutiveFails;
    let oks = check.consecutiveOks;
    let statusChanged = false;
    if (outcome.isUp) {
      oks += 1;
      fails = 0;
      if (status !== CheckStatus.UP && (status === CheckStatus.PENDING || oks >= check.recoveryThreshold)) {
        status = CheckStatus.UP;
        statusChanged = true;
      }
    } else {
      fails += 1;
      oks = 0;
      if (status !== CheckStatus.DOWN && fails >= check.failureThreshold) {
        status = CheckStatus.DOWN;
        statusChanged = true;
      }
    }

    await this.prisma.monitoringCheck.update({
      where: { id: check.id },
      data: {
        status,
        consecutiveFails: fails,
        consecutiveOks: oks,
        lastCheckedAt: at,
        lastResponseMs: outcome.responseTimeMs,
        sslExpiresAt: outcome.sslExpiresAt ?? (check.type === CheckType.HTTPS ? check.sslExpiresAt : null),
        ...(statusChanged ? { lastStatusChangeAt: at } : {}),
      },
    });

    const context = { checkName: check.name, target: check.target, serverName: check.server?.name };
    if (statusChanged) {
      this.logger.log(`Kontrol durumu değişti: ${check.name} → ${status}`);
      this.realtime.emit('check.status', { checkId: check.id, status });
      if (status === CheckStatus.DOWN && check.notifyOnFailure) {
        await this.incidents.open({
          type: IncidentType.CHECK_DOWN,
          severity: IncidentSeverity.CRITICAL,
          title: `Erişilemiyor: ${check.name}`,
          description: `${CHECK_TYPE_LABELS[check.type]} kontrolü ${check.failureThreshold} ardışık denemede başarısız oldu. Son hata: ${outcome.errorMessage ?? 'bilinmiyor'}`,
          checkId: check.id,
          serverId: check.serverId,
          context,
        });
      } else if (status === CheckStatus.UP) {
        await this.incidents.resolveAuto(IncidentType.CHECK_DOWN, { checkId: check.id, serverId: check.serverId }, `Kontrol ${check.recoveryThreshold} ardışık denemede başarılı oldu`, context);
      }
    }

    if (check.type === CheckType.HTTPS && check.sslExpiryWarnDays && outcome.sslExpiresAt) {
      const daysLeft = Math.floor((outcome.sslExpiresAt.getTime() - at.getTime()) / 86_400_000);
      if (daysLeft <= check.sslExpiryWarnDays) {
        await this.incidents.open({
          type: IncidentType.SSL_EXPIRING,
          severity: daysLeft <= 3 ? IncidentSeverity.CRITICAL : IncidentSeverity.WARNING,
          title: daysLeft < 0 ? `SSL sertifikasının süresi doldu: ${check.name}` : `SSL sertifikası ${daysLeft} gün içinde doluyor: ${check.name}`,
          description: `Sertifika bitiş tarihi: ${outcome.sslExpiresAt.toISOString()}`,
          checkId: check.id,
          serverId: check.serverId,
          context,
        });
      } else {
        await this.incidents.resolveAuto(IncidentType.SSL_EXPIRING, { checkId: check.id, serverId: check.serverId }, 'Sertifika yenilendi', context);
      }
    }
  }

  async purgeResults(olderThanDays = 30): Promise<number> {
    const result = await this.prisma.checkResult.deleteMany({ where: { checkedAt: { lt: new Date(Date.now() - olderThanDays * 86_400_000) } } });
    return result.count;
  }

  private toView(check: MonitoringCheck & { server?: { id: string; name: string } | null }, uptime24h: number | null) {
    return {
      id: check.id,
      name: check.name,
      type: check.type,
      typeLabel: CHECK_TYPE_LABELS[check.type],
      target: check.target,
      port: check.port,
      method: check.method,
      expectedStatusCode: check.expectedStatusCode,
      intervalSec: check.intervalSec,
      timeoutSec: check.timeoutSec,
      retryCount: check.retryCount,
      failureThreshold: check.failureThreshold,
      recoveryThreshold: check.recoveryThreshold,
      sslExpiryWarnDays: check.sslExpiryWarnDays,
      sslExpiresAt: check.sslExpiresAt,
      notifyOnFailure: check.notifyOnFailure,
      isEnabled: check.isEnabled,
      status: check.status,
      consecutiveFails: check.consecutiveFails,
      consecutiveOks: check.consecutiveOks,
      lastCheckedAt: check.lastCheckedAt,
      lastStatusChangeAt: check.lastStatusChangeAt,
      lastResponseMs: check.lastResponseMs,
      server: check.server ?? null,
      uptime24h,
      createdAt: check.createdAt,
      updatedAt: check.updatedAt,
    };
  }
}
