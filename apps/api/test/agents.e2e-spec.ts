import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { AgentsService } from '../src/agents/agents.service';
import { signRequest } from '../src/agents/agent-signing';
import { createTestApp, extractCookie } from './setup-e2e';

const CSRF = { 'X-Requested-With': 'XMLHttpRequest' };
const ADMIN = { email: 'admin@ornek.com', fullName: 'İlk Yönetici', password: 'CokGizliParola123' };

const HOST = {
  hostname: 'srv-test-01',
  osFamily: 'WINDOWS',
  osName: 'Windows Server 2019 Standard',
  osVersion: '10.0.17763',
  osEdition: 'Standard',
  kernelVersion: '10.0.17763',
  architecture: 'amd64',
  cpuModel: 'Test CPU',
  cpuCores: 4,
  totalMemoryBytes: 8_589_934_592,
  bootTime: '2026-11-20T08:00:00.000Z',
};

function sample(timestamp: string) {
  return {
    timestamp,
    cpu: { percent: 12.5 },
    memory: { totalBytes: 8_589_934_592, usedBytes: 4_294_967_296, availableBytes: 4_294_967_296, percent: 50 },
    disks: [{ volume: 'C:', fsType: 'NTFS', totalBytes: 100e9, usedBytes: 40e9, freeBytes: 60e9, readBytesPerSec: 1000, writeBytesPerSec: 2000 }],
    network: [{ name: 'Ethernet', rxBytesPerSec: 512, txBytesPerSec: 256, isUp: true }],
    uptimeSeconds: 3600,
  };
}

describe('Ajan kaydı ve iletişimi (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let reset: () => Promise<void>;
  let adminCookie: string;

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
    adminCookie = `tm_session=${extractCookie(res.headers['set-cookie'], 'tm_session')}`;
  });

  const server = () => app.getHttpServer() as Parameters<typeof request>[0];

  async function createToken(overrides: Record<string, unknown> = {}): Promise<{ token: string; id: string }> {
    const res = await request(server())
      .post('/api/v1/registration-tokens')
      .set('Cookie', adminCookie)
      .set(CSRF)
      .send({ osFamily: 'WINDOWS', osVersion: 'windows-server-2019', architecture: 'amd64', ...overrides })
      .expect(201);
    expect(res.body.token).toMatch(/^tmr_/);
    return { token: res.body.token as string, id: res.body.record.id as string };
  }

  async function registerAgent(token: string) {
    const res = await request(server()).post('/api/v1/agents/register').send({ registrationToken: token, agentVersion: '0.1.0', host: HOST }).expect(201);
    return res.body as { agentId: string; serverId: string; keyId: string; secret: string; collectionIntervalSec: number; heartbeatIntervalSec: number };
  }

  function signed(creds: { keyId: string; secret: string }, path: string, body: unknown, overrides: Partial<{ timestamp: string; nonce: string; signature: string }> = {}) {
    const json = JSON.stringify(body);
    const timestamp = overrides.timestamp ?? String(Math.floor(Date.now() / 1000));
    const nonce = overrides.nonce ?? randomBytes(16).toString('hex');
    const signature = overrides.signature ?? signRequest(creds.secret, { method: 'POST', requestUri: path, timestamp, nonce, body: json });
    return request(server())
      .post(path)
      .set('Content-Type', 'application/json')
      .set('X-Agent-Key', creds.keyId)
      .set('X-Agent-Timestamp', timestamp)
      .set('X-Agent-Nonce', nonce)
      .set('X-Agent-Signature', signature)
      .send(json);
  }

  it('kayıt belirteci oluşturulur, listelenir ve iptal edilir; düz metin yalnızca bir kez döner', async () => {
    const { token, id } = await createToken({ serverName: 'Üretim DB' });
    const list = await request(server()).get('/api/v1/registration-tokens').set('Cookie', adminCookie).expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].status).toBe('ACTIVE');
    expect(list.body[0].serverName).toBe('Üretim DB');
    expect(JSON.stringify(list.body)).not.toContain(token.slice(12));

    await request(server()).delete(`/api/v1/registration-tokens/${id}`).set('Cookie', adminCookie).set(CSRF).expect(204);
    const after = await request(server()).get('/api/v1/registration-tokens').set('Cookie', adminCookie).expect(200);
    expect(after.body[0].status).toBe('REVOKED');

    const denied = await request(server()).post('/api/v1/agents/register').send({ registrationToken: token, agentVersion: '0.1.0', host: HOST }).expect(401);
    expect(denied.body.code).toBe('REGISTRATION_TOKEN_INVALID');
  });

  it('desteklenmeyen sürüm ve izleyici yetkisi reddedilir', async () => {
    await request(server()).post('/api/v1/registration-tokens').set('Cookie', adminCookie).set(CSRF).send({ osFamily: 'LINUX', osVersion: 'windows-server-2019' }).expect(400);
    await request(server())
      .post('/api/v1/users')
      .set('Cookie', adminCookie)
      .set(CSRF)
      .send({ email: 'izleyici@ornek.com', fullName: 'İzleyici', password: 'IzleyiciParola123', role: 'VIEWER' })
      .expect(201);
    const login = await request(server()).post('/api/v1/auth/login').send({ email: 'izleyici@ornek.com', password: 'IzleyiciParola123' }).expect(200);
    const viewer = `tm_session=${extractCookie(login.headers['set-cookie'], 'tm_session')}`;
    await request(server()).post('/api/v1/registration-tokens').set('Cookie', viewer).set(CSRF).send({ osFamily: 'LINUX' }).expect(403);
  });

  it('ajan kaydolur, belirteç tek kullanımlıktır ve işletim sistemi ailesi eşleşmelidir', async () => {
    const { token } = await createToken({ serverName: 'Dosya Sunucusu' });
    const creds = await registerAgent(token);
    expect(creds.keyId).toMatch(/^tma_[0-9a-f]{32}$/);
    expect(creds.secret.length).toBeGreaterThanOrEqual(40);
    expect(creds.heartbeatIntervalSec).toBe(30);

    const serverRow = await prisma.server.findUniqueOrThrow({ where: { id: creds.serverId }, include: { agent: { include: { credentials: true, events: true } } } });
    expect(serverRow.name).toBe('Dosya Sunucusu');
    expect(serverRow.status).toBe('ONLINE');
    expect(serverRow.osName).toBe(HOST.osName);
    expect(serverRow.totalMemoryBytes).toBe(BigInt(HOST.totalMemoryBytes));
    expect(serverRow.agent?.credentials[0].secretEncrypted).not.toContain(creds.secret);
    expect(serverRow.agent?.events.map((e) => e.type).sort()).toEqual(['CONNECTED', 'REGISTERED']);

    const reuse = await request(server()).post('/api/v1/agents/register').send({ registrationToken: token, agentVersion: '0.1.0', host: HOST }).expect(401);
    expect(reuse.body.code).toBe('REGISTRATION_TOKEN_INVALID');

    const linuxToken = await createToken({ osFamily: 'LINUX', osVersion: 'ubuntu-24.04' });
    const mismatch = await request(server()).post('/api/v1/agents/register').send({ registrationToken: linuxToken.token, agentVersion: '0.1.0', host: HOST }).expect(400);
    expect(mismatch.body.code).toBe('REGISTRATION_OS_MISMATCH');

    const audit = await prisma.auditLog.findMany({ where: { action: 'agent.register' } });
    expect(audit.map((a) => a.result).sort()).toEqual(['DENIED', 'SUCCESS']);
  });

  it('heartbeat imzayla doğrulanır; yeniden oynatma, bozuk imza ve eski zaman damgası reddedilir', async () => {
    const { token } = await createToken();
    const creds = await registerAgent(token);
    const body = { agentVersion: '0.1.1', uptimeSeconds: 120, host: HOST };

    const ok = await signed(creds, '/api/v1/agents/heartbeat', body).expect(200);
    expect(ok.body.collectionIntervalSec).toBe(15);
    expect(ok.body.serverName).toBe('srv-test-01');

    const nonce = randomBytes(16).toString('hex');
    await signed(creds, '/api/v1/agents/heartbeat', body, { nonce }).expect(200);
    const replay = await signed(creds, '/api/v1/agents/heartbeat', body, { nonce }).expect(401);
    expect(replay.body.code).toBe('AGENT_REPLAY_DETECTED');

    const bad = await signed(creds, '/api/v1/agents/heartbeat', body, { signature: 'a'.repeat(64) }).expect(401);
    expect(bad.body.code).toBe('AGENT_AUTH_INVALID');

    const stale = await signed(creds, '/api/v1/agents/heartbeat', body, { timestamp: String(Math.floor(Date.now() / 1000) - 3600) }).expect(401);
    expect(stale.body.code).toBe('AGENT_TIMESTAMP_SKEW');

    const wrongSecret = await signed({ keyId: creds.keyId, secret: 'yanlis' }, '/api/v1/agents/heartbeat', body).expect(401);
    expect(wrongSecret.body.code).toBe('AGENT_AUTH_INVALID');

    const missing = await request(server()).post('/api/v1/agents/heartbeat').send(body).expect(401);
    expect(missing.body.code).toBe('AGENT_AUTH_REQUIRED');

    const agentRow = await prisma.agent.findUniqueOrThrow({ where: { id: creds.agentId }, include: { events: true } });
    expect(agentRow.version).toBe('0.1.1');
    expect(agentRow.events.some((e) => e.type === 'VERSION_CHANGED')).toBe(true);
  });

  it('metrikler alınır, çift örnekler atlanır, geçersiz zaman damgaları reddedilir', async () => {
    const { token } = await createToken();
    const creds = await registerAgent(token);
    const t1 = new Date(Date.now() - 30_000).toISOString();
    const t2 = new Date(Date.now() - 15_000).toISOString();
    const old = new Date(Date.now() - 48 * 3600_000).toISOString();

    const res = await signed(creds, '/api/v1/agents/metrics', { samples: [sample(t1), sample(t2), sample(old)] }).expect(200);
    expect(res.body).toEqual({ accepted: 2, rejected: 1 });

    const again = await signed(creds, '/api/v1/agents/metrics', { samples: [sample(t1)] }).expect(200);
    expect(again.body.accepted).toBe(1);
    expect(await prisma.metricSample.count({ where: { serverId: creds.serverId } })).toBe(2);
    expect(await prisma.diskSample.count({ where: { serverId: creds.serverId } })).toBe(2);
    expect(await prisma.networkInterfaceSample.count({ where: { serverId: creds.serverId } })).toBe(2);

    const row = await prisma.metricSample.findFirstOrThrow({ where: { serverId: creds.serverId }, orderBy: { timestamp: 'asc' } });
    expect(row.cpuPercent).toBe(12.5);
    expect(row.diskReadBps).toBe(1000);
    expect(row.netRxBps).toBe(512);
    expect(row.memoryTotalBytes).toBe(BigInt(8_589_934_592));

    const invalid = await signed(creds, '/api/v1/agents/metrics', { samples: [{ ...sample(t2), cpu: { percent: 150 } }] }).expect(400);
    expect(invalid.body.code).toBe('VALIDATION_FAILED');
  });

  it('iptal edilmiş kimlik bilgisi reddedilir', async () => {
    const { token } = await createToken();
    const creds = await registerAgent(token);
    await prisma.agentCredential.update({ where: { keyId: creds.keyId }, data: { status: 'REVOKED', revokedAt: new Date() } });
    const res = await signed(creds, '/api/v1/agents/heartbeat', { agentVersion: '0.1.0', host: HOST }).expect(401);
    expect(res.body.code).toBe('AGENT_CREDENTIAL_REVOKED');
  });

  it('heartbeat gelmeyen sunucular çevrimdışı işaretlenir ve geri geldiğinde çevrimiçi olur', async () => {
    const { token } = await createToken();
    const creds = await registerAgent(token);
    const agents = app.get(AgentsService);

    expect(await agents.sweepOfflineAgents()).toBe(0);
    await prisma.server.update({ where: { id: creds.serverId }, data: { lastHeartbeatAt: new Date(Date.now() - 120_000) } });
    expect(await agents.sweepOfflineAgents()).toBe(1);

    const offline = await prisma.server.findUniqueOrThrow({ where: { id: creds.serverId }, include: { agent: { include: { events: true } } } });
    expect(offline.status).toBe('OFFLINE');
    expect(offline.agent?.status).toBe('DISCONNECTED');
    expect(offline.agent?.events.filter((e) => e.type === 'DISCONNECTED')).toHaveLength(1);
    expect(await agents.sweepOfflineAgents()).toBe(0);

    await signed(creds, '/api/v1/agents/heartbeat', { agentVersion: '0.1.0', host: HOST }).expect(200);
    const online = await prisma.server.findUniqueOrThrow({ where: { id: creds.serverId }, include: { agent: { include: { events: true } } } });
    expect(online.status).toBe('ONLINE');
    expect(online.agent?.status).toBe('CONNECTED');
    expect(online.agent?.events.filter((e) => e.type === 'CONNECTED')).toHaveLength(2);
  });
});
