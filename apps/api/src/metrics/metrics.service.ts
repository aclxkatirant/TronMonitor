import { Injectable } from '@nestjs/common';
import { AggregateResolution, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/app-error';
import { SettingsService } from '../settings/settings.service';
import type { MetricsQueryDto } from './dto/metrics.dto';

const MAX_POINTS = 360;
const NICE_BUCKETS_SEC = [15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 21600, 43200, 86400];
const MAX_CUSTOM_RANGE_MS = 400 * 24 * 60 * 60 * 1000;
const RANGE_MS: Record<string, number> = {
  '1h': 3_600_000,
  '6h': 6 * 3_600_000,
  '24h': 24 * 3_600_000,
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
};

export type MetricSource = 'raw' | 'minute5' | 'hour1' | 'day1';

export interface ThresholdEvaluation {
  degraded: boolean;
  reasons: string[];
  cpu: boolean;
  memory: boolean;
  disks: string[];
  thresholds: { cpuPercent: number; memoryPercent: number; diskPercent: number; consecutiveSamples: number };
}

export interface ResolvedRange {
  from: Date;
  to: Date;
  bucketSeconds: number;
  source: MetricSource;
}

export interface MetricPoint {
  t: string;
  cpuAvg: number | null;
  cpuMax: number | null;
  memAvg: number | null;
  memMax: number | null;
  netRx: number | null;
  netTx: number | null;
  diskRead: number | null;
  diskWrite: number | null;
  diskUsedPct: number | null;
  load1: number | null;
  load5: number | null;
  load15: number | null;
  samples: number;
}

interface RawRow {
  bucket: Date;
  cpu_avg: number | null;
  cpu_max: number | null;
  mem_avg: number | null;
  mem_max: number | null;
  rx: number | null;
  tx: number | null;
  dr: number | null;
  dw: number | null;
  l1: number | null;
  l5: number | null;
  l15: number | null;
  n: bigint;
}

interface AggregateRow {
  bucket: Date;
  cpu_avg: number | null;
  cpu_max: number | null;
  mem_avg: number | null;
  mem_max: number | null;
  rx: number | null;
  tx: number | null;
  disk_pct: number | null;
  n: bigint;
}

interface VolumeRow {
  bucket: Date;
  volume: string;
  used: number | null;
  total: number | null;
}

interface InterfaceRow {
  bucket: Date;
  name: string;
  rx: number | null;
  tx: number | null;
}

function niceBucket(rangeSec: number, minimumSec: number): number {
  const target = Math.max(minimumSec, Math.ceil(rangeSec / MAX_POINTS));
  return NICE_BUCKETS_SEC.find((b) => b >= target) ?? NICE_BUCKETS_SEC[NICE_BUCKETS_SEC.length - 1];
}

const num = (value: number | bigint | null | undefined): number | null => (value === null || value === undefined ? null : Number(value));
const round = (value: number | null, digits = 2): number | null => (value === null ? null : Math.round(value * 10 ** digits) / 10 ** digits);

@Injectable()
export class MetricsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** Zaman aralığını çözer ve veri kaynağını (ham / özet) seçer. */
  async resolveRange(query: MetricsQueryDto, now = new Date()): Promise<ResolvedRange> {
    let from: Date;
    let to: Date;
    if (query.range === 'custom') {
      if (!query.from || !query.to) throw AppError.badRequest('VALIDATION_FAILED', ['Özel aralık için başlangıç ve bitiş tarihleri gereklidir.']);
      from = new Date(query.from);
      to = new Date(query.to);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
        throw AppError.badRequest('VALIDATION_FAILED', ['Bitiş tarihi başlangıçtan sonra olmalıdır.']);
      }
      if (to.getTime() - from.getTime() > MAX_CUSTOM_RANGE_MS) {
        throw AppError.badRequest('VALIDATION_FAILED', ['Özel aralık en fazla 400 gün olabilir.']);
      }
    } else {
      to = now;
      from = new Date(now.getTime() - RANGE_MS[query.range]);
    }

    const { retention } = await this.settings.getMonitoring();
    const rangeSec = (to.getTime() - from.getTime()) / 1000;
    const rawAvailableFrom = now.getTime() - retention.rawDays * 86_400_000;
    const minute5AvailableFrom = now.getTime() - retention.minute5Days * 86_400_000;
    const hour1AvailableFrom = now.getTime() - retention.hour1Days * 86_400_000;

    let source: MetricSource;
    let bucketSeconds: number;
    if (from.getTime() >= rawAvailableFrom) {
      source = 'raw';
      bucketSeconds = niceBucket(rangeSec, 15);
    } else if (from.getTime() >= minute5AvailableFrom) {
      source = 'minute5';
      bucketSeconds = niceBucket(rangeSec, 300);
    } else if (from.getTime() >= hour1AvailableFrom) {
      source = 'hour1';
      bucketSeconds = niceBucket(rangeSec, 3600);
    } else {
      source = 'day1';
      bucketSeconds = 86400;
    }
    return { from, to, bucketSeconds, source };
  }

  private async assertServer(serverId: string): Promise<void> {
    const exists = await this.prisma.server.count({ where: { id: serverId } });
    if (!exists) throw AppError.notFound('SERVER_NOT_FOUND');
  }

  async history(serverId: string, query: MetricsQueryDto): Promise<{ range: ResolvedRange; points: MetricPoint[] }> {
    await this.assertServer(serverId);
    const range = await this.resolveRange(query);
    const points = range.source === 'raw' ? await this.rawHistory(serverId, range) : await this.aggregateHistory(serverId, range);
    return { range, points };
  }

  private async rawHistory(serverId: string, range: ResolvedRange): Promise<MetricPoint[]> {
    const rows = await this.prisma.$queryRaw<RawRow[]>`
      SELECT date_bin(make_interval(secs => ${range.bucketSeconds}), "timestamp", TIMESTAMP '2000-01-01') AS bucket,
             avg("cpuPercent") AS cpu_avg, max("cpuPercent") AS cpu_max,
             avg("memoryPercent") AS mem_avg, max("memoryPercent") AS mem_max,
             avg("netRxBps") AS rx, avg("netTxBps") AS tx,
             avg("diskReadBps") AS dr, avg("diskWriteBps") AS dw,
             avg("loadAvg1") AS l1, avg("loadAvg5") AS l5, avg("loadAvg15") AS l15,
             count(*) AS n
      FROM "MetricSample"
      WHERE "serverId" = ${serverId} AND "timestamp" >= ${range.from} AND "timestamp" < ${range.to}
      GROUP BY bucket ORDER BY bucket`;

    const diskRows = await this.prisma.$queryRaw<{ bucket: Date; pct: number | null }[]>`
      SELECT date_bin(make_interval(secs => ${range.bucketSeconds}), t, TIMESTAMP '2000-01-01') AS bucket, avg(pct) AS pct
      FROM (
        SELECT "timestamp" AS t, CASE WHEN sum("totalBytes") > 0 THEN sum("usedBytes")::float8 * 100 / sum("totalBytes")::float8 ELSE NULL END AS pct
        FROM "DiskSample"
        WHERE "serverId" = ${serverId} AND "timestamp" >= ${range.from} AND "timestamp" < ${range.to}
        GROUP BY "timestamp"
      ) per_sample
      GROUP BY bucket ORDER BY bucket`;
    const diskByBucket = new Map(diskRows.map((r) => [r.bucket.getTime(), num(r.pct)]));

    return rows.map((r) => ({
      t: r.bucket.toISOString(),
      cpuAvg: round(num(r.cpu_avg)),
      cpuMax: round(num(r.cpu_max)),
      memAvg: round(num(r.mem_avg)),
      memMax: round(num(r.mem_max)),
      netRx: round(num(r.rx), 0),
      netTx: round(num(r.tx), 0),
      diskRead: round(num(r.dr), 0),
      diskWrite: round(num(r.dw), 0),
      diskUsedPct: round(diskByBucket.get(r.bucket.getTime()) ?? null),
      load1: round(num(r.l1)),
      load5: round(num(r.l5)),
      load15: round(num(r.l15)),
      samples: Number(r.n),
    }));
  }

  private async aggregateHistory(serverId: string, range: ResolvedRange): Promise<MetricPoint[]> {
    const resolution = range.source === 'minute5' ? AggregateResolution.MINUTE_5 : range.source === 'hour1' ? AggregateResolution.HOUR_1 : AggregateResolution.DAY_1;
    const rows = await this.prisma.$queryRaw<AggregateRow[]>`
      SELECT date_bin(make_interval(secs => ${range.bucketSeconds}), "bucketStart", TIMESTAMP '2000-01-01') AS bucket,
             sum("cpuAvg" * "sampleCount") / NULLIF(sum("sampleCount"), 0) AS cpu_avg, max("cpuMax") AS cpu_max,
             sum("memoryAvg" * "sampleCount") / NULLIF(sum("sampleCount"), 0) AS mem_avg, max("memoryMax") AS mem_max,
             avg("netRxBpsAvg") AS rx, avg("netTxBpsAvg") AS tx, avg("diskUsedPctAvg") AS disk_pct,
             sum("sampleCount") AS n
      FROM "MetricAggregate"
      WHERE "serverId" = ${serverId} AND "resolution" = ${resolution}::"AggregateResolution"
        AND "bucketStart" >= ${range.from} AND "bucketStart" < ${range.to}
      GROUP BY bucket ORDER BY bucket`;
    return rows.map((r) => ({
      t: r.bucket.toISOString(),
      cpuAvg: round(num(r.cpu_avg)),
      cpuMax: round(num(r.cpu_max)),
      memAvg: round(num(r.mem_avg)),
      memMax: round(num(r.mem_max)),
      netRx: round(num(r.rx), 0),
      netTx: round(num(r.tx), 0),
      diskRead: null,
      diskWrite: null,
      diskUsedPct: round(num(r.disk_pct)),
      load1: null,
      load5: null,
      load15: null,
      samples: Number(r.n),
    }));
  }

  /** Hacim bazında disk kullanım yüzdesi geçmişi (yalnızca ham örnek saklama penceresi içinde). */
  async volumeHistory(serverId: string, query: MetricsQueryDto) {
    await this.assertServer(serverId);
    const range = await this.resolveRange(query);
    if (range.source !== 'raw') return { range, available: false, series: [] as { volume: string; points: { t: string; usedPct: number | null; usedBytes: number | null; totalBytes: number | null }[] }[] };
    const rows = await this.prisma.$queryRaw<VolumeRow[]>`
      SELECT date_bin(make_interval(secs => ${range.bucketSeconds}), "timestamp", TIMESTAMP '2000-01-01') AS bucket, "volume",
             avg("usedBytes")::float8 AS used, max("totalBytes")::float8 AS total
      FROM "DiskSample"
      WHERE "serverId" = ${serverId} AND "timestamp" >= ${range.from} AND "timestamp" < ${range.to}
      GROUP BY bucket, "volume" ORDER BY "volume", bucket`;
    const series = new Map<string, { t: string; usedPct: number | null; usedBytes: number | null; totalBytes: number | null }[]>();
    for (const r of rows) {
      const list = series.get(r.volume) ?? [];
      const used = num(r.used);
      const total = num(r.total);
      list.push({ t: r.bucket.toISOString(), usedPct: used !== null && total ? round((used * 100) / total) : null, usedBytes: round(used, 0), totalBytes: round(total, 0) });
      series.set(r.volume, list);
    }
    return { range, available: true, series: [...series].map(([volume, points]) => ({ volume, points })) };
  }

  /** Arayüz bazında trafik geçmişi (yalnızca ham örnek saklama penceresi içinde). */
  async interfaceHistory(serverId: string, query: MetricsQueryDto) {
    await this.assertServer(serverId);
    const range = await this.resolveRange(query);
    if (range.source !== 'raw') return { range, available: false, series: [] as { name: string; points: { t: string; rx: number | null; tx: number | null }[] }[] };
    const rows = await this.prisma.$queryRaw<InterfaceRow[]>`
      SELECT date_bin(make_interval(secs => ${range.bucketSeconds}), "timestamp", TIMESTAMP '2000-01-01') AS bucket, "interfaceName" AS name,
             avg("rxBps") AS rx, avg("txBps") AS tx
      FROM "NetworkInterfaceSample"
      WHERE "serverId" = ${serverId} AND "timestamp" >= ${range.from} AND "timestamp" < ${range.to}
      GROUP BY bucket, "interfaceName" ORDER BY "interfaceName", bucket`;
    const series = new Map<string, { t: string; rx: number | null; tx: number | null }[]>();
    for (const r of rows) {
      const list = series.get(r.name) ?? [];
      list.push({ t: r.bucket.toISOString(), rx: round(num(r.rx), 0), tx: round(num(r.tx), 0) });
      series.set(r.name, list);
    }
    return { range, available: true, series: [...series].map(([name, points]) => ({ name, points })) };
  }

  // ---------------------------------------------------------------------------
  // Özetleme ve saklama
  // ---------------------------------------------------------------------------

  /**
   * Ham örnekleri 5 dakikalık, 5 dakikalıkları saatlik, saatlikleri günlük özetlere toplar.
   * Son pencereler her çalışmada yeniden hesaplanır; böylece tamponlanıp geç gelen örnekler de dahil olur.
   */
  async aggregate(now = new Date()): Promise<{ minute5: number; hour1: number; day1: number }> {
    const floor = (ms: number, step: number) => new Date(Math.floor(ms / step) * step);
    const cutoff5 = floor(now.getTime(), 300_000);
    const since5 = new Date(cutoff5.getTime() - 2 * 3_600_000);
    const minute5 = await this.prisma.$executeRaw`
      WITH disk AS (
        SELECT "serverId", date_bin('5 minutes', t, TIMESTAMP '2000-01-01') AS bucket, avg(pct) AS pct
        FROM (
          SELECT "serverId", "timestamp" AS t,
                 CASE WHEN sum("totalBytes") > 0 THEN sum("usedBytes")::float8 * 100 / sum("totalBytes")::float8 END AS pct
          FROM "DiskSample"
          WHERE "timestamp" >= ${since5} AND "timestamp" < ${cutoff5}
          GROUP BY "serverId", "timestamp"
        ) per_sample
        GROUP BY "serverId", bucket
      ), base AS (
        SELECT "serverId", date_bin('5 minutes', "timestamp", TIMESTAMP '2000-01-01') AS bucket,
               avg("cpuPercent") AS cpu_avg, max("cpuPercent") AS cpu_max,
               avg("memoryPercent") AS mem_avg, max("memoryPercent") AS mem_max,
               avg("netRxBps") AS rx, avg("netTxBps") AS tx, count(*) AS n
        FROM "MetricSample"
        WHERE "timestamp" >= ${since5} AND "timestamp" < ${cutoff5}
        GROUP BY "serverId", bucket
      )
      INSERT INTO "MetricAggregate" ("serverId", "resolution", "bucketStart", "cpuAvg", "cpuMax", "memoryAvg", "memoryMax", "netRxBpsAvg", "netTxBpsAvg", "diskUsedPctAvg", "sampleCount")
      SELECT b."serverId", 'MINUTE_5'::"AggregateResolution", b.bucket, b.cpu_avg, b.cpu_max, b.mem_avg, b.mem_max, b.rx, b.tx, d.pct, b.n
      FROM base b LEFT JOIN disk d ON d."serverId" = b."serverId" AND d.bucket = b.bucket
      ON CONFLICT ("serverId", "resolution", "bucketStart") DO UPDATE SET
        "cpuAvg" = EXCLUDED."cpuAvg", "cpuMax" = EXCLUDED."cpuMax", "memoryAvg" = EXCLUDED."memoryAvg", "memoryMax" = EXCLUDED."memoryMax",
        "netRxBpsAvg" = EXCLUDED."netRxBpsAvg", "netTxBpsAvg" = EXCLUDED."netTxBpsAvg", "diskUsedPctAvg" = EXCLUDED."diskUsedPctAvg", "sampleCount" = EXCLUDED."sampleCount"`;

    const cutoffHour = floor(now.getTime(), 3_600_000);
    const sinceHour = new Date(cutoffHour.getTime() - 26 * 3_600_000);
    const hour1 = await this.rollup(AggregateResolution.MINUTE_5, AggregateResolution.HOUR_1, '1 hour', sinceHour, cutoffHour);

    const cutoffDay = floor(now.getTime(), 86_400_000);
    const sinceDay = new Date(cutoffDay.getTime() - 3 * 86_400_000);
    const day1 = await this.rollup(AggregateResolution.HOUR_1, AggregateResolution.DAY_1, '1 day', sinceDay, cutoffDay);

    return { minute5, hour1, day1 };
  }

  private rollup(from: AggregateResolution, to: AggregateResolution, step: string, since: Date, cutoff: Date): Promise<number> {
    return this.prisma.$executeRaw`
      INSERT INTO "MetricAggregate" ("serverId", "resolution", "bucketStart", "cpuAvg", "cpuMax", "memoryAvg", "memoryMax", "netRxBpsAvg", "netTxBpsAvg", "diskUsedPctAvg", "sampleCount")
      SELECT "serverId", ${to}::"AggregateResolution", date_bin(${step}::interval, "bucketStart", TIMESTAMP '2000-01-01') AS bucket,
             sum("cpuAvg" * "sampleCount") / NULLIF(sum("sampleCount"), 0), max("cpuMax"),
             sum("memoryAvg" * "sampleCount") / NULLIF(sum("sampleCount"), 0), max("memoryMax"),
             avg("netRxBpsAvg"), avg("netTxBpsAvg"), avg("diskUsedPctAvg"), sum("sampleCount")
      FROM "MetricAggregate"
      WHERE "resolution" = ${from}::"AggregateResolution" AND "bucketStart" >= ${since} AND "bucketStart" < ${cutoff}
      GROUP BY "serverId", bucket
      ON CONFLICT ("serverId", "resolution", "bucketStart") DO UPDATE SET
        "cpuAvg" = EXCLUDED."cpuAvg", "cpuMax" = EXCLUDED."cpuMax", "memoryAvg" = EXCLUDED."memoryAvg", "memoryMax" = EXCLUDED."memoryMax",
        "netRxBpsAvg" = EXCLUDED."netRxBpsAvg", "netTxBpsAvg" = EXCLUDED."netTxBpsAvg", "diskUsedPctAvg" = EXCLUDED."diskUsedPctAvg", "sampleCount" = EXCLUDED."sampleCount"`;
  }

  /** Saklama politikasını uygular; silinen satır sayılarını döndürür. */
  async applyRetention(now = new Date()): Promise<Record<string, number>> {
    const { retention } = await this.settings.getMonitoring();
    const before = (days: number) => new Date(now.getTime() - days * 86_400_000);
    const rawCutoff = before(retention.rawDays);
    const [metricSamples, diskSamples, networkSamples, minute5, hour1, day1] = await this.prisma.$transaction([
      this.prisma.metricSample.deleteMany({ where: { timestamp: { lt: rawCutoff } } }),
      this.prisma.diskSample.deleteMany({ where: { timestamp: { lt: rawCutoff } } }),
      this.prisma.networkInterfaceSample.deleteMany({ where: { timestamp: { lt: rawCutoff } } }),
      this.prisma.metricAggregate.deleteMany({ where: { resolution: AggregateResolution.MINUTE_5, bucketStart: { lt: before(retention.minute5Days) } } }),
      this.prisma.metricAggregate.deleteMany({ where: { resolution: AggregateResolution.HOUR_1, bucketStart: { lt: before(retention.hour1Days) } } }),
      this.prisma.metricAggregate.deleteMany({ where: { resolution: AggregateResolution.DAY_1, bucketStart: { lt: before(retention.day1Days) } } }),
    ]);
    return {
      metricSamples: metricSamples.count,
      diskSamples: diskSamples.count,
      networkSamples: networkSamples.count,
      minute5: minute5.count,
      hour1: hour1.count,
      day1: day1.count,
    };
  }

  /** En son örneklere göre en yoğun sunucular (izleme genel görünümü için). */
  async topServers(limit = 5) {
    const rows = await this.prisma.$queryRaw<{ serverId: string; name: string; status: string; cpuPercent: number; memoryPercent: number; timestamp: Date }[]>`
      SELECT s."id" AS "serverId", s."name", s."status"::text AS status, m."cpuPercent", m."memoryPercent", m."timestamp"
      FROM "Server" s
      JOIN LATERAL (SELECT "cpuPercent", "memoryPercent", "timestamp" FROM "MetricSample" WHERE "serverId" = s."id" ORDER BY "timestamp" DESC LIMIT 1) m ON true
      WHERE s."status" IN ('ONLINE', 'DEGRADED')`;
    const byCpu = [...rows].sort((a, b) => b.cpuPercent - a.cpuPercent).slice(0, limit);
    const byMemory = [...rows].sort((a, b) => b.memoryPercent - a.memoryPercent).slice(0, limit);
    return { byCpu, byMemory, sampled: rows.length };
  }

  /** Ardışık örneklere göre eşik aşımı var mı? Sunucu durumu ve olaylar için kullanılır. */
  async evaluateThresholds(serverId: string): Promise<ThresholdEvaluation> {
    const { thresholds } = await this.settings.getMonitoring();
    const samples = await this.prisma.metricSample.findMany({
      where: { serverId },
      orderBy: { timestamp: 'desc' },
      take: thresholds.consecutiveSamples,
      select: { timestamp: true, cpuPercent: true, memoryPercent: true },
    });
    const empty: ThresholdEvaluation = { degraded: false, reasons: [], cpu: false, memory: false, disks: [], thresholds };
    if (samples.length < thresholds.consecutiveSamples) return empty;
    const reasons: string[] = [];
    const cpu = samples.every((s) => s.cpuPercent >= thresholds.cpuPercent);
    const memory = samples.every((s) => s.memoryPercent >= thresholds.memoryPercent);
    if (cpu) reasons.push(`CPU ≥ %${thresholds.cpuPercent}`);
    if (memory) reasons.push(`Bellek ≥ %${thresholds.memoryPercent}`);

    const timestamps = samples.map((s) => s.timestamp);
    const diskRows = await this.prisma.$queryRaw<{ volume: string; hits: bigint }[]>`
      SELECT "volume", count(*) AS hits FROM "DiskSample"
      WHERE "serverId" = ${serverId} AND "timestamp" IN (${Prisma.join(timestamps)})
        AND "totalBytes" > 0 AND "usedBytes"::float8 * 100 / "totalBytes"::float8 >= ${thresholds.diskPercent}
      GROUP BY "volume"`;
    const disks: string[] = [];
    for (const row of diskRows) {
      if (Number(row.hits) >= thresholds.consecutiveSamples) {
        disks.push(row.volume);
        reasons.push(`Disk ${row.volume} ≥ %${thresholds.diskPercent}`);
      }
    }
    return { degraded: reasons.length > 0, reasons, cpu, memory, disks, thresholds };
  }
}
