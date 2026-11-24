import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { signRequest } from '../src/agents/agent-signing';
import { createTestApp, extractCookie } from './setup-e2e';

const CSRF = { 'X-Requested-With': 'XMLHttpRequest' };
const ADMIN = { email: 'admin@ornek.com', fullName: 'İlk Yönetici', password: 'CokGizliParola123' };
const HOST = { hostname: 'web-01', osFamily: 'LINUX', osName: 'Ubuntu 24.04.1 LTS', osVersion: '24.04', kernelVersion: '6.8.0', architecture: 'amd64', cpuModel: 'Test CPU', cpuCores: 2, totalMemoryBytes: 4_294_967_296 };

describe('Sunucu yönetimi (e2e)', () => {
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
    const res = await request(server()).post('/api/v1/auth/register').send(ADMIN).expect(201);
    admin = `tm_session=${extractCookie(res.headers['set-cookie'], 'tm_session')}`;
  });

  const server = () => app.getHttpServer() as Parameters<typeof request>[0];

  async function registerServer(name: string, host = HOST) {
    const tokenRes = await request(server()).post('/api/v1/registration-tokens').set('Cookie', admin).set(CSRF).send({ osFamily: host.osFamily, serverName: name }).expect(201);
    const reg = await request(server()).post('/api/v1/agents/register').send({ registrationToken: tokenRes.body.token, agentVersion: '0.1.0', host }).expect(201);
    return reg.body as { serverId: string; agentId: string; keyId: string; secret: string };
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

  async function sendMetrics(creds: { keyId: string; secret: string }, cpu: number) {
    await signed(creds, '/api/v1/agents/metrics', {
      samples: [
        {
          timestamp: new Date().toISOString(),
          cpu: { percent: cpu },
          memory: { totalBytes: 4e9, usedBytes: 2e9, availableBytes: 2e9, percent: 50 },
          disks: [
            { volume: '/', totalBytes: 100e9, usedBytes: 30e9, freeBytes: 70e9 },
            { volume: '/data', totalBytes: 100e9, usedBytes: 50e9, freeBytes: 50e9 },
          ],
          network: [{ name: 'eth0', rxBytesPerSec: 100, txBytesPerSec: 50, isUp: true }],
          uptimeSeconds: 100,
        },
      ],
    }).expect(200);
  }

  it('sunucular listelenir, filtrelenir ve son metriklerle gelir', async () => {
    const a = await registerServer('Web 01');
    await registerServer('DB 01', { ...HOST, hostname: 'db-01', osFamily: 'WINDOWS', osName: 'Windows Server 2022' });
    await sendMetrics(a, 42);

    const list = await request(server()).get('/api/v1/servers').set('Cookie', admin).expect(200);
    expect(list.body.total).toBe(2);
    const web = list.body.items.find((s: { name: string }) => s.name === 'Web 01');
    expect(web.status).toBe('ONLINE');
    expect(web.metrics.cpuPercent).toBe(42);
    expect(web.metrics.diskUsedPercent).toBe(40);
    expect(web.agent.status).toBe('CONNECTED');

    const windows = await request(server()).get('/api/v1/servers?osFamily=WINDOWS').set('Cookie', admin).expect(200);
    expect(windows.body.items.map((s: { name: string }) => s.name)).toEqual(['DB 01']);
    const search = await request(server()).get('/api/v1/servers?search=web').set('Cookie', admin).expect(200);
    expect(search.body.total).toBe(1);
    const sorted = await request(server()).get('/api/v1/servers?sort=name&order=desc').set('Cookie', admin).expect(200);
    expect(sorted.body.items[0].name).toBe('Web 01');
    await request(server()).get('/api/v1/servers?sort=bilinmeyen').set('Cookie', admin).expect(400);
  });

  it('sunucu ayrıntısı disk, ağ ve ajan bilgisi içerir; güncelleme grup ve etiket atar', async () => {
    const a = await registerServer('Web 01');
    await sendMetrics(a, 10);
    const detail = await request(server()).get(`/api/v1/servers/${a.serverId}`).set('Cookie', admin).expect(200);
    expect(detail.body.osName).toBe('Ubuntu 24.04.1 LTS');
    expect(detail.body.disks).toHaveLength(2);
    expect(detail.body.disks[0].usedPercent).toBe(30);
    expect(detail.body.network[0].name).toBe('eth0');
    expect(detail.body.agent.credential.keyId).toBe(a.keyId);
    expect(JSON.stringify(detail.body)).not.toContain(a.secret);

    const group = await request(server()).post('/api/v1/server-groups').set('Cookie', admin).set(CSRF).send({ name: 'Üretim', color: '#22c55e' }).expect(201);
    const tag = await request(server()).post('/api/v1/tags').set('Cookie', admin).set(CSRF).send({ name: 'web' }).expect(201);
    await request(server()).post('/api/v1/server-groups').set('Cookie', admin).set(CSRF).send({ name: 'üretim' }).expect(409);

    const updated = await request(server())
      .patch(`/api/v1/servers/${a.serverId}`)
      .set('Cookie', admin)
      .set(CSRF)
      .send({ name: 'Web Sunucusu', description: 'Ana web', groupId: group.body.id, tagIds: [tag.body.id] })
      .expect(200);
    expect(updated.body.name).toBe('Web Sunucusu');
    expect(updated.body.group.name).toBe('Üretim');
    expect(updated.body.tags[0].name).toBe('web');

    const byTag = await request(server()).get(`/api/v1/servers?tagId=${tag.body.id}`).set('Cookie', admin).expect(200);
    expect(byTag.body.total).toBe(1);
    const groups = await request(server()).get('/api/v1/server-groups').set('Cookie', admin).expect(200);
    expect(groups.body[0].serverCount).toBe(1);

    await request(server()).delete(`/api/v1/server-groups/${group.body.id}`).set('Cookie', admin).set(CSRF).expect(204);
    const afterGroup = await request(server()).get(`/api/v1/servers/${a.serverId}`).set('Cookie', admin).expect(200);
    expect(afterGroup.body.group).toBeNull();

    await request(server()).patch(`/api/v1/servers/${a.serverId}`).set('Cookie', admin).set(CSRF).send({ groupId: '00000000-0000-4000-8000-000000000000' }).expect(404);
    await request(server()).patch(`/api/v1/servers/${a.serverId}`).set('Cookie', admin).set(CSRF).send({ name: '' }).expect(400);
  });

  it('ajan iptali veri gönderimini durdurur; toplama aralığı güncellenir; olaylar listelenir', async () => {
    const a = await registerServer('Web 01');
    await request(server()).patch(`/api/v1/servers/${a.serverId}/agent`).set('Cookie', admin).set(CSRF).send({ collectionIntervalSec: 60 }).expect(200);
    const hb = await signed(a, '/api/v1/agents/heartbeat', { agentVersion: '0.1.0', host: HOST }).expect(200);
    expect(hb.body.collectionIntervalSec).toBe(60);
    await request(server()).patch(`/api/v1/servers/${a.serverId}/agent`).set('Cookie', admin).set(CSRF).send({ collectionIntervalSec: 1 }).expect(400);

    const revoked = await request(server()).post(`/api/v1/servers/${a.serverId}/agent/revoke`).set('Cookie', admin).set(CSRF).expect(200);
    expect(revoked.body.status).toBe('OFFLINE');
    expect(revoked.body.agent.status).toBe('REVOKED');
    expect(revoked.body.agent.credential.status).toBe('REVOKED');
    const denied = await signed(a, '/api/v1/agents/heartbeat', { agentVersion: '0.1.0', host: HOST }).expect(401);
    expect(denied.body.code).toBe('AGENT_CREDENTIAL_REVOKED');
    await request(server()).post(`/api/v1/servers/${a.serverId}/agent/revoke`).set('Cookie', admin).set(CSRF).expect(409);

    const events = await request(server()).get(`/api/v1/servers/${a.serverId}/events`).set('Cookie', admin).expect(200);
    expect(events.body.items.map((e: { type: string }) => e.type)).toEqual(['CREDENTIAL_REVOKED', 'CONNECTED', 'REGISTERED']);
    const audit = await prisma.auditLog.findMany({ where: { action: 'agent.revoke' } });
    expect(audit).toHaveLength(1);
  });

  it('sunucu silinir ve izleyici değiştiremez', async () => {
    const a = await registerServer('Web 01');
    await sendMetrics(a, 5);
    await request(server())
      .post('/api/v1/users')
      .set('Cookie', admin)
      .set(CSRF)
      .send({ email: 'izleyici@ornek.com', fullName: 'İzleyici', password: 'IzleyiciParola123', role: 'VIEWER' })
      .expect(201);
    const login = await request(server()).post('/api/v1/auth/login').send({ email: 'izleyici@ornek.com', password: 'IzleyiciParola123' }).expect(200);
    const viewer = `tm_session=${extractCookie(login.headers['set-cookie'], 'tm_session')}`;
    await request(server()).get('/api/v1/servers').set('Cookie', viewer).expect(200);
    await request(server()).patch(`/api/v1/servers/${a.serverId}`).set('Cookie', viewer).set(CSRF).send({ name: 'X' }).expect(403);
    await request(server()).delete(`/api/v1/servers/${a.serverId}`).set('Cookie', viewer).set(CSRF).expect(403);

    await request(server()).delete(`/api/v1/servers/${a.serverId}`).set('Cookie', admin).set(CSRF).expect(204);
    await request(server()).get(`/api/v1/servers/${a.serverId}`).set('Cookie', admin).expect(404);
    expect(await prisma.metricSample.count()).toBe(0);
    expect(await prisma.agentCredential.count()).toBe(0);
  });

  it('pano özeti gerçek sayıları döndürür', async () => {
    const a = await registerServer('Web 01');
    const b = await registerServer('DB 01', { ...HOST, hostname: 'db-01', osFamily: 'WINDOWS' });
    await sendMetrics(a, 20);
    await sendMetrics(b, 60);
    await prisma.server.update({ where: { id: b.serverId }, data: { status: 'OFFLINE' } });

    const summary = await request(server()).get('/api/v1/dashboard/summary').set('Cookie', admin).expect(200);
    expect(summary.body.servers).toMatchObject({ total: 2, online: 1, offline: 1, windows: 1, linux: 1 });
    expect(summary.body.availabilityPercent).toBe(50);
    expect(summary.body.usage.avgCpuPercent).toBe(20);
    expect(summary.body.usage.sampledServers).toBe(1);
    expect(summary.body.recentEvents.length).toBeGreaterThanOrEqual(2);
    expect(summary.body.recentEvents[0].serverName).toBeTruthy();
  });

  it('ajan dosyaları listelenir ve özet dosyası ile kurulum betiği indirilir', async () => {
    const list = await request(server()).get('/api/v1/agent-downloads').expect(200);
    const names = list.body.files.map((f: { name: string }) => f.name);
    expect(names).toContain('tronmonitor-agent-linux-amd64');
    expect(names).toContain('install-agent.sh');
    const script = await request(server()).get('/api/v1/agent-downloads/install-agent.sh').expect(200);
    expect(script.text).toContain('tronmonitor-agent');
    await request(server()).get('/api/v1/agent-downloads/../package.json').expect(404);
    await request(server()).get('/api/v1/agent-downloads/.env').expect(404);
  });
});
