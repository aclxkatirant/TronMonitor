import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { MetricsService } from '../src/metrics/metrics.service';
import { MaintenanceService } from '../src/queue/maintenance.service';
import { SettingsService } from '../src/settings/settings.service';
import { signRequest } from '../src/agents/agent-signing';
import { createTestApp, extractCookie } from './setup-e2e';

const CSRF = { 'X-Requested-With': 'XMLHttpRequest' };
const ADMIN = { email: 'admin@ornek.com', fullName: 'İlk Yönetici', password: 'CokGizliParola123' };
const HOST = { hostname: 'metrik-01', osFamily: 'LINUX', osName: 'Debian 12', architecture: 'amd64', cpuCores: 2, totalMemoryBytes: 4e9 };

describe('Metrik geçmişi, özetleme ve ayarlar (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let reset: () => Promise<void>;
  let admin: string;

  beforeAll(async () => {
    ({ app, prisma, reset } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await reset();
    await app.get(RedisService).client.flushdb();
    app.get(SettingsService).invalidate();
    const res = await request(server()).post('/api/v1/auth/register').send(ADMIN).expect(201);
    admin = `tm_session=${extractCookie(res.headers['set-cookie'], 'tm_session')}`;
  });

  const server = () => app.getHttpServer() as Parameters<typeof request>[0];

  async function registerServer() {
    const tokenRes = await request(server()).post('/api/v1/registration-tokens').set('Cookie', admin).set(CSRF).send({ osFamily: 'LINUX' }).expect(201);
    const reg = await request(server()).post('/api/v1/agents/register').send({ registrationToken: tokenRes.body.token, agentVersion: '0.1.0', host: HOST }).expect(201);
    return reg.body as { serverId: string; keyId: string; secret: string };
  }

  function signed(creds: { keyId: string; secret: string }, path: string, body: unknown) {
    const json = JSON.stringify(body);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = randomBytes(16).toString('hex');
    return request(server())
      .post(path)
      .set('Content-Type', 'application/json')
      .set('X-Agent-Key', creds.keyId)
      .set('X-Agent-Timestamp', timestamp)
      .set('X-Agent-Nonce', nonce)
      .set('X-Agent-Signature', signRequest(creds.secret, { method: 'POST', requestUri: path, timestamp, nonce, body: json }))
      .send(json);
  }

  function sample(at: Date, cpu: number, mem = 50, diskUsed = 30e9) {
    return {
      timestamp: at.toISOString(),
      cpu: { percent: cpu },
      memory: { totalBytes: 4e9, usedBytes: (4e9 * mem) / 100, availableBytes: 4e9 - (4e9 * mem) / 100, percent: mem },
      disks: [{ volume: '/', totalBytes: 100e9, usedBytes: diskUsed, freeBytes: 100e9 - diskUsed }],
      network: [{ name: 'eth0', rxBytesPerSec: 100, txBytesPerSec: 200, isUp: true }],
      uptimeSeconds: 10,
    };
  }

  it('ham örneklerden zaman aralığına göre özetlenmiş geçmiş döner', async () => {
    const a = await registerServer();
    const now = Date.now();
    const samples = [];
    for (let i = 0; i < 20; i += 1) samples.push(sample(new Date(now - i * 15_000), 10 + i, 40));
    await signed(a, '/api/v1/agents/metrics', { samples }).expect(200);

    const res = await request(server()).get(`/api/v1/servers/${a.serverId}/metrics?range=1h`).set('Cookie', admin).expect(200);
    expect(res.body.range.source).toBe('raw');
    expect(res.body.range.bucketSeconds).toBe(15);
    expect(res.body.points.length).toBeGreaterThanOrEqual(19);
    const first = res.body.points[0];
    expect(first.cpuAvg).toBeGreaterThan(0);
    expect(first.memAvg).toBe(40);
    expect(first.netRx).toBe(100);
    expect(first.diskUsedPct).toBe(30);
    expect(first.samples).toBe(1);

    const wide = await request(server()).get(`/api/v1/servers/${a.serverId}/metrics?range=7d`).set('Cookie', admin).expect(200);
    expect(wide.body.range.bucketSeconds).toBe(1800);
    expect(wide.body.points.length).toBeLessThanOrEqual(2);
    expect(wide.body.points[wide.body.points.length - 1].samples).toBeGreaterThanOrEqual(1);

    const volumes = await request(server()).get(`/api/v1/servers/${a.serverId}/metrics/volumes?range=1h`).set('Cookie', admin).expect(200);
    expect(volumes.body.available).toBe(true);
    expect(volumes.body.series[0].volume).toBe('/');
    expect(volumes.body.series[0].points[0].usedPct).toBe(30);

    const ifaces = await request(server()).get(`/api/v1/servers/${a.serverId}/metrics/interfaces?range=1h`).set('Cookie', admin).expect(200);
    expect(ifaces.body.series[0].name).toBe('eth0');
    expect(ifaces.body.series[0].points[0].tx).toBe(200);
  });

  it('özel aralık doğrulanır ve geçersiz aralık reddedilir', async () => {
    const a = await registerServer();
    await request(server()).get(`/api/v1/servers/${a.serverId}/metrics?range=yil`).set('Cookie', admin).expect(400);
    await request(server()).get(`/api/v1/servers/${a.serverId}/metrics?range=custom`).set('Cookie', admin).expect(400);
    const from = new Date(Date.now() - 2 * 3600_000).toISOString();
    const to = new Date(Date.now() - 3 * 3600_000).toISOString();
    await request(server()).get(`/api/v1/servers/${a.serverId}/metrics?range=custom&from=${from}&to=${to}`).set('Cookie', admin).expect(400);
    const ok = await request(server()).get(`/api/v1/servers/${a.serverId}/metrics?range=custom&from=${to}&to=${from}`).set('Cookie', admin).expect(200);
    expect(ok.body.range.source).toBe('raw');
    await request(server()).get('/api/v1/servers/00000000-0000-4000-8000-000000000000/metrics').set('Cookie', admin).expect(404);
  });

  it('özetleme işi 5 dakikalık, saatlik ve günlük özetler üretir; eski aralıklar özetlerden okunur', async () => {
    const a = await registerServer();
    const metrics = app.get(MetricsService);
    // Tamamlanmış bir 5 dakikalık pencereye ait örnekler (şu andan 10-15 dakika önce).
    const base = Math.floor((Date.now() - 15 * 60_000) / 300_000) * 300_000;
    const rows = [];
    for (let i = 0; i < 10; i += 1) rows.push(sample(new Date(base + i * 20_000), 50 + i, 60));
    await signed(a, '/api/v1/agents/metrics', { samples: rows }).expect(200);

    const result = await metrics.aggregate();
    expect(result.minute5).toBeGreaterThanOrEqual(1);
    const m5 = await prisma.metricAggregate.findMany({ where: { serverId: a.serverId, resolution: 'MINUTE_5' } });
    expect(m5).toHaveLength(1);
    expect(m5[0].sampleCount).toBe(10);
    expect(m5[0].cpuAvg).toBeCloseTo(54.5, 1);
    expect(m5[0].cpuMax).toBe(59);
    expect(m5[0].diskUsedPctAvg).toBeCloseTo(30, 1);

    // Saatlik özet yalnızca tamamlanmış saat için üretilir; geçmiş bir saatlik veri ekleyip tekrar çalıştır.
    const hourAgo = Math.floor((Date.now() - 2 * 3600_000) / 3600_000) * 3600_000;
    await prisma.metricAggregate.create({
      data: { serverId: a.serverId, resolution: 'MINUTE_5', bucketStart: new Date(hourAgo + 300_000), cpuAvg: 20, cpuMax: 30, memoryAvg: 40, memoryMax: 50, netRxBpsAvg: 1, netTxBpsAvg: 2, diskUsedPctAvg: 10, sampleCount: 20 },
    });
    await prisma.metricAggregate.create({
      data: { serverId: a.serverId, resolution: 'MINUTE_5', bucketStart: new Date(hourAgo + 600_000), cpuAvg: 40, cpuMax: 70, memoryAvg: 40, memoryMax: 50, netRxBpsAvg: 3, netTxBpsAvg: 4, diskUsedPctAvg: 20, sampleCount: 20 },
    });
    await metrics.aggregate();
    // Yalnızca eklenen saat denetlenir; güncel saatin tamamlanmış olması durumunda ek satırlar oluşabilir.
    const h1 = await prisma.metricAggregate.findMany({ where: { serverId: a.serverId, resolution: 'HOUR_1', bucketStart: new Date(hourAgo) } });
    expect(h1).toHaveLength(1);
    expect(h1[0].cpuAvg).toBeCloseTo(30, 1);
    expect(h1[0].cpuMax).toBe(70);
    expect(h1[0].sampleCount).toBe(40);

    // 30 günlük aralık ham pencerenin dışına taşar → 5 dakikalık özetlerden okunur.
    const wide = await request(server()).get(`/api/v1/servers/${a.serverId}/metrics?range=30d`).set('Cookie', admin).expect(200);
    expect(wide.body.range.source).toBe('minute5');
    expect(wide.body.points.length).toBeGreaterThanOrEqual(1);
  });

  it('saklama politikası eski verileri siler, yenileri korur', async () => {
    const a = await registerServer();
    const metrics = app.get(MetricsService);
    const old = new Date(Date.now() - 10 * 86_400_000);
    await prisma.metricSample.create({ data: { serverId: a.serverId, timestamp: old, cpuPercent: 1, memoryTotalBytes: 1n, memoryUsedBytes: 1n, memoryPercent: 1 } });
    await prisma.metricAggregate.create({ data: { serverId: a.serverId, resolution: 'MINUTE_5', bucketStart: new Date(Date.now() - 40 * 86_400_000), cpuAvg: 1, cpuMax: 1, memoryAvg: 1, memoryMax: 1, sampleCount: 1 } });
    await prisma.metricAggregate.create({ data: { serverId: a.serverId, resolution: 'HOUR_1', bucketStart: new Date(Date.now() - 40 * 86_400_000), cpuAvg: 1, cpuMax: 1, memoryAvg: 1, memoryMax: 1, sampleCount: 1 } });
    await signed(a, '/api/v1/agents/metrics', { samples: [sample(new Date(), 5)] }).expect(200);

    const deleted = await metrics.applyRetention();
    expect(deleted.metricSamples).toBe(1);
    expect(deleted.minute5).toBe(1);
    expect(deleted.hour1).toBe(0);
    expect(await prisma.metricSample.count({ where: { serverId: a.serverId } })).toBe(1);

    const maintenance = app.get(MaintenanceService);
    expect(maintenance.jobNames).toEqual(expect.arrayContaining(['agent-status-sweep', 'metrics-aggregate', 'retention']));
    const viaJob = (await maintenance.run('retention')) as Record<string, number>;
    expect(viaJob.metricSamples).toBe(0);
  });

  it('eşik aşımı sunucuyu sorunlu, toparlanma çevrimiçi yapar; ayarlar yetkiyle değiştirilir', async () => {
    const a = await registerServer();
    const current = await request(server()).get('/api/v1/settings/monitoring').set('Cookie', admin).expect(200);
    expect(current.body.thresholds.cpuPercent).toBe(90);
    expect(current.body.defaults.retention.rawDays).toBe(7);

    await request(server())
      .put('/api/v1/settings/monitoring')
      .set('Cookie', admin)
      .set(CSRF)
      .send({ thresholds: { cpuPercent: 80, memoryPercent: 95, diskPercent: 95, consecutiveSamples: 2 }, retention: { rawDays: 7, minute5Days: 30, hour1Days: 365, day1Days: 730 } })
      .expect(200);
    await request(server())
      .put('/api/v1/settings/monitoring')
      .set('Cookie', admin)
      .set(CSRF)
      .send({ thresholds: { cpuPercent: 10, memoryPercent: 95, diskPercent: 95, consecutiveSamples: 2 }, retention: { rawDays: 7, minute5Days: 30, hour1Days: 365, day1Days: 730 } })
      .expect(400);

    const now = Date.now();
    await signed(a, '/api/v1/agents/metrics', { samples: [sample(new Date(now - 30_000), 85)] }).expect(200);
    let row = await prisma.server.findUniqueOrThrow({ where: { id: a.serverId } });
    expect(row.status).toBe('ONLINE');
    await signed(a, '/api/v1/agents/metrics', { samples: [sample(new Date(now - 15_000), 92)] }).expect(200);
    row = await prisma.server.findUniqueOrThrow({ where: { id: a.serverId } });
    expect(row.status).toBe('DEGRADED');

    const summary = await request(server()).get('/api/v1/dashboard/summary').set('Cookie', admin).expect(200);
    expect(summary.body.servers.degraded).toBe(1);

    await signed(a, '/api/v1/agents/metrics', { samples: [sample(new Date(now), 20)] }).expect(200);
    row = await prisma.server.findUniqueOrThrow({ where: { id: a.serverId } });
    expect(row.status).toBe('ONLINE');

    const top = await request(server()).get('/api/v1/metrics/top').set('Cookie', admin).expect(200);
    expect(top.body.byCpu[0].serverId).toBe(a.serverId);

    // Yönetici (ADMIN) ayarları okuyabilir ama değiştiremez.
    await request(server()).post('/api/v1/users').set('Cookie', admin).set(CSRF).send({ email: 'yonetici@ornek.com', fullName: 'Yönetici', password: 'YoneticiParola123', role: 'ADMIN' }).expect(201);
    const login = await request(server()).post('/api/v1/auth/login').send({ email: 'yonetici@ornek.com', password: 'YoneticiParola123' }).expect(200);
    const adminUser = `tm_session=${extractCookie(login.headers['set-cookie'], 'tm_session')}`;
    await request(server()).get('/api/v1/settings/monitoring').set('Cookie', adminUser).expect(200);
    await request(server()).put('/api/v1/settings/monitoring').set('Cookie', adminUser).set(CSRF).send(current.body).expect(403);
  });
});
