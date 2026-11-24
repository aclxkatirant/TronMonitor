import type { INestApplication } from '@nestjs/common';
import { createServer, type Server as HttpServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { AgentsService } from '../src/agents/agents.service';
import { UptimeService } from '../src/uptime/uptime.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { SettingsService } from '../src/settings/settings.service';
import { signRequest } from '../src/agents/agent-signing';
import { createTestApp, extractCookie } from './setup-e2e';

const CSRF = { 'X-Requested-With': 'XMLHttpRequest' };
const ADMIN = { email: 'admin@ornek.com', fullName: 'İlk Yönetici', password: 'CokGizliParola123' };
const HOST = { hostname: 'olay-01', osFamily: 'LINUX', osName: 'Ubuntu 24.04', architecture: 'amd64', cpuCores: 2, totalMemoryBytes: 4e9 };

/** Discord webhook'unu taklit eden yerel HTTP sunucusu; ayrıca erişilebilirlik hedefi olarak kullanılır. */
class FakeEndpoint {
  server!: HttpServer;
  port = 0;
  received: unknown[] = [];
  statusCode = 200;

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => {
        if (req.method === 'POST') {
          try {
            this.received.push(JSON.parse(body));
          } catch {
            this.received.push(body);
          }
        }
        res.statusCode = this.statusCode;
        res.end(this.statusCode >= 400 ? 'hata' : 'ok');
      });
    });
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    const address = this.server.address();
    this.port = typeof address === 'object' && address ? address.port : 0;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

describe('Olaylar, bildirimler ve erişilebilirlik (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let reset: () => Promise<void>;
  let admin: string;
  const endpoint = new FakeEndpoint();

  beforeAll(async () => {
    ({ app, prisma, reset } = await createTestApp());
    await endpoint.start();
  });
  afterAll(async () => {
    await endpoint.stop();
    await app.close();
  });
  beforeEach(async () => {
    await reset();
    await prisma.notification.deleteMany();
    await prisma.notificationChannel.deleteMany();
    await prisma.monitoringCheck.deleteMany();
    await app.get(RedisService).client.flushdb();
    app.get(SettingsService).invalidate();
    endpoint.received = [];
    endpoint.statusCode = 200;
    const res = await request(server()).post('/api/v1/auth/register').send(ADMIN).expect(201);
    admin = `tm_session=${extractCookie(res.headers['set-cookie'], 'tm_session')}`;
  });

  const server = () => app.getHttpServer() as Parameters<typeof request>[0];

  async function registerServer() {
    const tokenRes = await request(server()).post('/api/v1/registration-tokens').set('Cookie', admin).set(CSRF).send({ osFamily: 'LINUX', serverName: 'Olay Sunucusu' }).expect(201);
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

  function sample(at: Date, cpu: number) {
    return {
      timestamp: at.toISOString(),
      cpu: { percent: cpu },
      memory: { totalBytes: 4e9, usedBytes: 1e9, availableBytes: 3e9, percent: 25 },
      disks: [{ volume: '/', totalBytes: 100e9, usedBytes: 10e9, freeBytes: 90e9 }],
      network: [],
      uptimeSeconds: 10,
    };
  }

  async function createDiscordChannel(events: string[]) {
    // Webhook adresi Discord biçiminde olmalı; gerçek gönderim sahte uç noktaya yönlendirilemez, bu yüzden
    // yalnızca kanal yönetimi burada test edilir, gönderim ayrı bir testte yerel sunucu ile yapılır.
    const res = await request(server())
      .post('/api/v1/notification-channels')
      .set('Cookie', admin)
      .set(CSRF)
      .send({ name: 'Ops Discord', type: 'DISCORD', config: { webhookUrl: 'https://discord.com/api/webhooks/123/abcdefGHIJKL' }, enabledEvents: events })
      .expect(201);
    return res.body as { id: string; config: { webhookUrl: string } };
  }

  it('ajan sessizliği kritik olay açar, yeniden bağlanınca olay çözülür', async () => {
    const creds = await registerServer();
    const agents = app.get(AgentsService);
    await prisma.server.update({ where: { id: creds.serverId }, data: { lastHeartbeatAt: new Date(Date.now() - 120_000) } });
    expect(await agents.sweepOfflineAgents()).toBe(1);

    const list = await request(server()).get('/api/v1/incidents?status=active').set('Cookie', admin).expect(200);
    expect(list.body.total).toBe(1);
    const incident = list.body.items[0];
    expect(incident.type).toBe('AGENT_DISCONNECTED');
    expect(incident.severity).toBe('CRITICAL');
    expect(incident.typeLabel).toBe('Ajan bağlantısı kesildi');
    expect(incident.server.name).toBe('Olay Sunucusu');

    // İkinci tarama aynı olayı tekrar açmaz.
    await prisma.server.update({ where: { id: creds.serverId }, data: { status: 'ONLINE', lastHeartbeatAt: new Date(Date.now() - 120_000) } });
    await prisma.agent.update({ where: { serverId: creds.serverId }, data: { status: 'CONNECTED' } });
    await agents.sweepOfflineAgents();
    expect(await prisma.incident.count()).toBe(1);

    await signed(creds, '/api/v1/agents/heartbeat', { agentVersion: '0.1.0', host: HOST }).expect(200);
    const detail = await request(server()).get(`/api/v1/incidents/${incident.id}`).set('Cookie', admin).expect(200);
    expect(detail.body.status).toBe('RESOLVED');
    expect(detail.body.resolutionNote).toBe('Ajan yeniden bağlandı');
    expect(detail.body.events.map((e: { kind: string }) => e.kind)).toEqual(['CREATED', 'RESOLVED']);
    expect(detail.body.durationSeconds).toBeGreaterThanOrEqual(0);
  });

  it('olay üstlenilir, not eklenir ve elle çözülür; izleyici değiştiremez', async () => {
    const creds = await registerServer();
    await prisma.server.update({ where: { id: creds.serverId }, data: { lastHeartbeatAt: new Date(Date.now() - 120_000) } });
    await app.get(AgentsService).sweepOfflineAgents();
    const incident = (await prisma.incident.findFirstOrThrow()).id;

    await request(server()).post('/api/v1/users').set('Cookie', admin).set(CSRF).send({ email: 'izleyici@ornek.com', fullName: 'İzleyici', password: 'IzleyiciParola123', role: 'VIEWER' }).expect(201);
    const login = await request(server()).post('/api/v1/auth/login').send({ email: 'izleyici@ornek.com', password: 'IzleyiciParola123' }).expect(200);
    const viewer = `tm_session=${extractCookie(login.headers['set-cookie'], 'tm_session')}`;
    await request(server()).get('/api/v1/incidents').set('Cookie', viewer).expect(200);
    await request(server()).post(`/api/v1/incidents/${incident}/acknowledge`).set('Cookie', viewer).set(CSRF).send({}).expect(403);

    const ack = await request(server()).post(`/api/v1/incidents/${incident}/acknowledge`).set('Cookie', admin).set(CSRF).send({ note: 'Bakıyorum' }).expect(200);
    expect(ack.body.status).toBe('ACKNOWLEDGED');
    expect(ack.body.acknowledgedBy).toBe('İlk Yönetici');
    await request(server()).post(`/api/v1/incidents/${incident}/acknowledge`).set('Cookie', admin).set(CSRF).send({}).expect(409);
    await request(server()).post(`/api/v1/incidents/${incident}/notes`).set('Cookie', admin).set(CSRF).send({ note: 'Ağ ekibine iletildi' }).expect(200);
    const resolved = await request(server()).post(`/api/v1/incidents/${incident}/resolve`).set('Cookie', admin).set(CSRF).send({ note: 'Anahtar değiştirildi' }).expect(200);
    expect(resolved.body.status).toBe('RESOLVED');
    expect(resolved.body.resolvedBy).toBe('İlk Yönetici');
    expect(resolved.body.events.map((e: { kind: string }) => e.kind)).toEqual(['CREATED', 'ACKNOWLEDGED', 'NOTE', 'RESOLVED']);
    await request(server()).post(`/api/v1/incidents/${incident}/resolve`).set('Cookie', admin).set(CSRF).send({}).expect(409);
    const audit = await prisma.auditLog.findMany({ where: { action: { in: ['incident.create', 'incident.acknowledge', 'incident.resolve', 'incident.note'] } } });
    expect(audit).toHaveLength(4);
  });

  it('eşik aşımı kaynak olayı açar ve toparlanınca çözer', async () => {
    const creds = await registerServer();
    await request(server())
      .put('/api/v1/settings/monitoring')
      .set('Cookie', admin)
      .set(CSRF)
      .send({ thresholds: { cpuPercent: 80, memoryPercent: 95, diskPercent: 95, consecutiveSamples: 2 }, retention: { rawDays: 7, minute5Days: 30, hour1Days: 365, day1Days: 730 } })
      .expect(200);
    const now = Date.now();
    await signed(creds, '/api/v1/agents/metrics', { samples: [sample(new Date(now - 30_000), 90), sample(new Date(now - 15_000), 95)] }).expect(200);
    const open = await request(server()).get('/api/v1/incidents?status=active&type=HIGH_CPU').set('Cookie', admin).expect(200);
    expect(open.body.total).toBe(1);
    expect(open.body.items[0].severity).toBe('WARNING');
    await signed(creds, '/api/v1/agents/metrics', { samples: [sample(new Date(now), 10), sample(new Date(now + 15_000), 10)] }).expect(200);
    const after = await request(server()).get('/api/v1/incidents?status=active').set('Cookie', admin).expect(200);
    expect(after.body.total).toBe(0);
    const resolved = await request(server()).get('/api/v1/incidents?status=RESOLVED').set('Cookie', admin).expect(200);
    expect(resolved.body.items[0].resolutionNote).toContain('CPU');
  });

  it('bildirim kanalı oluşturulur, sırlar maskelenir, güncellemede boş sır korunur', async () => {
    const channel = await createDiscordChannel(['AGENT_DISCONNECTED', 'AGENT_RECOVERED']);
    expect(channel.config.webhookUrl).not.toContain('abcdefGHIJKL');
    expect(channel.config.webhookUrl.endsWith('GHIJKL')).toBe(true);

    await request(server()).post('/api/v1/notification-channels').set('Cookie', admin).set(CSRF).send({ name: 'Kötü', type: 'DISCORD', config: { webhookUrl: 'https://ornek.com/hook' }, enabledEvents: [] }).expect(400);
    await request(server()).post('/api/v1/notification-channels').set('Cookie', admin).set(CSRF).send({ name: 'TG', type: 'TELEGRAM', config: { botToken: 'yanlis', chatId: '1' }, enabledEvents: [] }).expect(400);
    const tg = await request(server()).post('/api/v1/notification-channels').set('Cookie', admin).set(CSRF).send({ name: 'TG', type: 'TELEGRAM', config: { botToken: '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ', chatId: '-100123' }, enabledEvents: ['CHECK_DOWN'] }).expect(201);
    expect(tg.body.config.botToken).not.toContain('ABCDEFGHIJ');
    const email = await request(server()).post('/api/v1/notification-channels').set('Cookie', admin).set(CSRF).send({ name: 'Posta', type: 'EMAIL', config: { host: 'smtp.ornek.com', port: 587, secure: false, username: 'u', password: 'gizli', from: 'tron@ornek.com', to: ['ops@ornek.com'] }, enabledEvents: ['CHECK_DOWN'] }).expect(201);
    expect(email.body.config.password).not.toBe('gizli');

    const updated = await request(server()).patch(`/api/v1/notification-channels/${channel.id}`).set('Cookie', admin).set(CSRF).send({ name: 'Ops Discord 2', config: { webhookUrl: '', username: 'Tron' }, isEnabled: false }).expect(200);
    expect(updated.body.name).toBe('Ops Discord 2');
    expect(updated.body.isEnabled).toBe(false);
    expect(updated.body.config.webhookUrl.endsWith('GHIJKL')).toBe(true);
    expect(updated.body.config.username).toBe('Tron');

    const list = await request(server()).get('/api/v1/notification-channels').set('Cookie', admin).expect(200);
    expect(list.body).toHaveLength(3);
    expect(JSON.stringify(list.body)).not.toContain('abcdefGHIJKL');
    const rows = await prisma.notificationChannel.findMany();
    expect(rows.every((r) => !r.encryptedConfig.includes('abcdefGHIJKL') && r.encryptedConfig.startsWith('v1:'))).toBe(true);

    await request(server()).delete(`/api/v1/notification-channels/${tg.body.id}`).set('Cookie', admin).set(CSRF).expect(204);
    const catalog = await request(server()).get('/api/v1/notification-channels/meta/catalog').set('Cookie', admin).expect(200);
    expect(catalog.body.events.length).toBeGreaterThan(5);
  });

  it('olay açıldığında kayıtlı kanallara bildirim kuyruklanır ve gönderim durumu izlenir', async () => {
    const notifications = app.get(NotificationsService);
    await createDiscordChannel(['AGENT_DISCONNECTED', 'AGENT_RECOVERED']);
    await createDiscordChannel(['CHECK_DOWN']);
    const creds = await registerServer();
    await prisma.server.update({ where: { id: creds.serverId }, data: { lastHeartbeatAt: new Date(Date.now() - 120_000) } });
    await app.get(AgentsService).sweepOfflineAgents();

    const pending = await prisma.notification.findMany();
    expect(pending).toHaveLength(1);
    expect(pending[0].eventType).toBe('AGENT_DISCONNECTED');
    expect(pending[0].status).toBe('PENDING');
    const payload = pending[0].payload as { title: string; severity: string; fields: { label: string; value: string }[] };
    expect(payload.title).toContain('Olay Sunucusu');
    expect(payload.severity).toBe('CRITICAL');

    // Gerçek Discord'a ulaşılamaz (sahte webhook); gönderim başarısız kaydedilir, deneme sayısı artar.
    const result = await notifications.deliverPending();
    expect(result.failed).toBe(1);
    const after = await prisma.notification.findFirstOrThrow();
    expect(after.attempts).toBe(1);
    expect(after.lastError).toBeTruthy();

    await signed(creds, '/api/v1/agents/heartbeat', { agentVersion: '0.1.0', host: HOST }).expect(200);
    const recovery = await prisma.notification.findMany({ where: { eventType: 'AGENT_RECOVERED' } });
    expect(recovery).toHaveLength(1);
    const incident = await prisma.incident.findFirstOrThrow();
    const detail = await request(server()).get(`/api/v1/incidents/${incident.id}`).set('Cookie', admin).expect(200);
    expect(detail.body.notifications).toHaveLength(2);
  });

  it('HTTP kontrolü çalışır, eşiklere göre DOWN/UP geçer ve olay açıp kapatır', async () => {
    const uptime = app.get(UptimeService);
    const created = await request(server())
      .post('/api/v1/checks')
      .set('Cookie', admin)
      .set(CSRF)
      .send({ name: 'Yerel uç nokta', type: 'HTTP', target: `http://127.0.0.1:${endpoint.port}/saglik`, intervalSec: 10, timeoutSec: 2, retryCount: 0, failureThreshold: 2, recoveryThreshold: 1 })
      .expect(201);
    const id = created.body.id as string;
    expect(created.body.status).toBe('PENDING');

    await request(server()).post('/api/v1/checks').set('Cookie', admin).set(CSRF).send({ name: 'Bozuk', type: 'HTTPS', target: 'http://ornek.com' }).expect(400);
    await request(server()).post('/api/v1/checks').set('Cookie', admin).set(CSRF).send({ name: 'Bozuk', type: 'TCP', target: 'ornek.com' }).expect(400);

    const first = await request(server()).post(`/api/v1/checks/${id}/run`).set('Cookie', admin).set(CSRF).expect(200);
    expect(first.body.isUp).toBe(true);
    expect(first.body.statusCode).toBe(200);
    let detail = await request(server()).get(`/api/v1/checks/${id}`).set('Cookie', admin).expect(200);
    expect(detail.body.status).toBe('UP');
    expect(detail.body.uptime24h).toBe(100);

    endpoint.statusCode = 503;
    await uptime.execute(id);
    detail = await request(server()).get(`/api/v1/checks/${id}`).set('Cookie', admin).expect(200);
    expect(detail.body.status).toBe('UP');
    expect(detail.body.consecutiveFails).toBe(1);
    await uptime.execute(id);
    detail = await request(server()).get(`/api/v1/checks/${id}`).set('Cookie', admin).expect(200);
    expect(detail.body.status).toBe('DOWN');
    expect(detail.body.activeIncidents).toHaveLength(1);
    expect(detail.body.activeIncidents[0].type).toBe('CHECK_DOWN');

    endpoint.statusCode = 200;
    await uptime.execute(id);
    detail = await request(server()).get(`/api/v1/checks/${id}`).set('Cookie', admin).expect(200);
    expect(detail.body.status).toBe('UP');
    expect(detail.body.activeIncidents).toHaveLength(0);

    const results = await request(server()).get(`/api/v1/checks/${id}/results?limit=10`).set('Cookie', admin).expect(200);
    expect(results.body).toHaveLength(4);
    expect(results.body.map((r: { isUp: boolean }) => r.isUp)).toEqual([true, false, false, true]);
    const history = await request(server()).get(`/api/v1/checks/${id}/history?range=1h`).set('Cookie', admin).expect(200);
    expect(history.body.points.length).toBeGreaterThanOrEqual(1);
    expect(history.body.points[0].availability).toBe(50);
    expect(history.body.points[0].avgMs).toBeGreaterThanOrEqual(0);

    const summary = await request(server()).get('/api/v1/checks/summary').set('Cookie', admin).expect(200);
    expect(summary.body.checks).toBe(1);
    expect(summary.body.percent).toBe(50);
    const dash = await request(server()).get('/api/v1/dashboard/summary').set('Cookie', admin).expect(200);
    expect(dash.body.uptime.percent).toBe(50);
  });

  it('süresi gelen kontroller zamanlayıcıyla çalışır; TCP ve ICMP kontrolleri sonuç üretir', async () => {
    const uptime = app.get(UptimeService);
    await request(server()).post('/api/v1/checks').set('Cookie', admin).set(CSRF).send({ name: 'TCP', type: 'TCP', target: '127.0.0.1', port: endpoint.port, intervalSec: 10, timeoutSec: 2, retryCount: 0 }).expect(201);
    await request(server()).post('/api/v1/checks').set('Cookie', admin).set(CSRF).send({ name: 'Kapalı port', type: 'TCP', target: '127.0.0.1', port: 1, intervalSec: 10, timeoutSec: 2, retryCount: 0, failureThreshold: 1 }).expect(201);
    await request(server()).post('/api/v1/checks').set('Cookie', admin).set(CSRF).send({ name: 'Ping', type: 'ICMP', target: '127.0.0.1', intervalSec: 10, timeoutSec: 2, retryCount: 0 }).expect(201);
    await request(server()).post('/api/v1/checks').set('Cookie', admin).set(CSRF).send({ name: 'Devre dışı', type: 'TCP', target: '127.0.0.1', port: endpoint.port, isEnabled: false }).expect(201);

    const run = await uptime.runDueChecks();
    expect(run.executed).toBe(3);
    const list = await request(server()).get('/api/v1/checks').set('Cookie', admin).expect(200);
    const byName = Object.fromEntries(list.body.map((c: { name: string; status: string; lastResponseMs: number | null }) => [c.name, c]));
    expect(byName['TCP'].status).toBe('UP');
    expect(byName['Kapalı port'].status).toBe('DOWN');
    expect(byName['Ping'].status).toBe('UP');
    expect(byName['Ping'].lastResponseMs).not.toBeNull();
    expect(byName['Devre dışı'].status).toBe('PENDING');

    // Aralık dolmadan tekrar çalıştırılmaz.
    const again = await uptime.runDueChecks();
    expect(again.executed).toBe(0);
    expect(await prisma.incident.count({ where: { type: 'CHECK_DOWN' } })).toBe(1);

    // Kontrol devre dışı bırakılınca açık olay kapanır.
    const closed = list.body.find((c: { name: string }) => c.name === 'Kapalı port') as { id: string };
    await request(server()).patch(`/api/v1/checks/${closed.id}`).set('Cookie', admin).set(CSRF).send({ isEnabled: false }).expect(200);
    expect(await prisma.incident.count({ where: { type: 'CHECK_DOWN', status: 'RESOLVED' } })).toBe(1);
    await request(server()).delete(`/api/v1/checks/${closed.id}`).set('Cookie', admin).set(CSRF).expect(204);
    await request(server()).get(`/api/v1/checks/${closed.id}`).set('Cookie', admin).expect(404);
  });
});
