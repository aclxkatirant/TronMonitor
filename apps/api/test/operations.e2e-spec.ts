import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { signRequest } from '../src/agents/agent-signing';
import { createTestApp, extractCookie } from './setup-e2e';

const CSRF = { 'X-Requested-With': 'XMLHttpRequest' };
const ADMIN = { email: 'admin@ornek.com', fullName: 'İlk Yönetici', password: 'CokGizliParola123' };
const HOST = { hostname: 'hizmet-01', osFamily: 'WINDOWS', osName: 'Windows Server 2022', architecture: 'amd64', cpuCores: 2, totalMemoryBytes: 4e9 };

describe('Hizmetler, komutlar, işlem kayıtları ve API belirteçleri (e2e)', () => {
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

  async function registerServer() {
    const tokenRes = await request(server()).post('/api/v1/registration-tokens').set('Cookie', admin).set(CSRF).send({ osFamily: 'WINDOWS', serverName: 'Hizmet Sunucusu' }).expect(201);
    const reg = await request(server()).post('/api/v1/agents/register').send({ registrationToken: tokenRes.body.token, agentVersion: '0.1.0', host: HOST }).expect(201);
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

  const report = (state: string) => ({
    services: [
      { name: 'Spooler', displayName: 'Print Spooler', state, startupType: 'Otomatik', isEnabled: true },
      { name: 'W32Time', displayName: 'Windows Time', state: 'RUNNING', startupType: 'El ile', isEnabled: true },
      { name: 'Bonjour Service', displayName: 'Bonjour Service', state: 'RUNNING', startupType: 'Otomatik', isEnabled: true },
    ],
  });

  it('hizmet raporu işlenir, izlenen hizmet durunca olay açılır ve toparlanınca kapanır', async () => {
    const a = await registerServer();
    const first = await signed(a, '/api/v1/agents/services', report('RUNNING')).expect(200);
    expect(first.body).toEqual({ accepted: 3, changed: 0 });

    const list = await request(server()).get(`/api/v1/servers/${a.serverId}/services`).set('Cookie', admin).expect(200);
    expect(list.body.total).toBe(3);
    expect(list.body.summary.RUNNING).toBe(3);
    const spooler = list.body.items.find((s: { name: string }) => s.name === 'Spooler') as { id: string; stateLabel: string; isMonitored: boolean };
    expect(spooler.stateLabel).toBe('Çalışıyor');
    expect(spooler.isMonitored).toBe(false);

    // İzlenmeyen hizmetin durması olay açmaz.
    await signed(a, '/api/v1/agents/services', report('STOPPED')).expect(200);
    expect(await prisma.incident.count()).toBe(0);
    await signed(a, '/api/v1/agents/services', report('RUNNING')).expect(200);

    await request(server()).patch(`/api/v1/servers/${a.serverId}/services/${spooler.id}`).set('Cookie', admin).set(CSRF).send({ isMonitored: true }).expect(200);
    const stopped = await signed(a, '/api/v1/agents/services', report('STOPPED')).expect(200);
    expect(stopped.body.changed).toBe(1);
    const incidents = await request(server()).get('/api/v1/incidents?status=active').set('Cookie', admin).expect(200);
    expect(incidents.body.total).toBe(1);
    expect(incidents.body.items[0].type).toBe('SERVICE_FAILURE');
    expect(incidents.body.items[0].title).toContain('Print Spooler');

    await signed(a, '/api/v1/agents/services', report('RUNNING')).expect(200);
    const after = await request(server()).get('/api/v1/incidents?status=active').set('Cookie', admin).expect(200);
    expect(after.body.total).toBe(0);

    const events = await request(server()).get(`/api/v1/servers/${a.serverId}/services/${spooler.id}/events`).set('Cookie', admin).expect(200);
    expect(events.body.map((e: { toState: string }) => e.toState)).toEqual(['RUNNING', 'STOPPED', 'RUNNING', 'STOPPED']);
    const monitored = await request(server()).get('/api/v1/services/monitored').set('Cookie', admin).expect(200);
    expect(monitored.body).toHaveLength(1);
    expect(monitored.body[0].server.name).toBe('Hizmet Sunucusu');
    await signed(a, '/api/v1/agents/services', { services: [{ name: 'bad/name', state: 'RUNNING' }] }).expect(400);
  });

  it('hizmet kontrolü yetki ister, komut heartbeat ile ajana iletilir ve sonucu kaydedilir', async () => {
    const a = await registerServer();
    await signed(a, '/api/v1/agents/services', report('RUNNING')).expect(200);
    const list = await request(server()).get(`/api/v1/servers/${a.serverId}/services`).set('Cookie', admin).expect(200);
    const spooler = list.body.items.find((s: { name: string }) => s.name === 'Spooler') as { id: string };

    await request(server()).post('/api/v1/users').set('Cookie', admin).set(CSRF).send({ email: 'op@ornek.com', fullName: 'Operatör', password: 'OperatorParola123', role: 'OPERATOR' }).expect(201);
    const login = await request(server()).post('/api/v1/auth/login').send({ email: 'op@ornek.com', password: 'OperatorParola123' }).expect(200);
    const operator = `tm_session=${extractCookie(login.headers['set-cookie'], 'tm_session')}`;
    await request(server()).post(`/api/v1/servers/${a.serverId}/services/${spooler.id}/control`).set('Cookie', operator).set(CSRF).send({ action: 'restart' }).expect(403);
    await request(server()).post(`/api/v1/servers/${a.serverId}/services/${spooler.id}/control`).set('Cookie', admin).set(CSRF).send({ action: 'exec' }).expect(400);

    const queued = await request(server()).post(`/api/v1/servers/${a.serverId}/services/${spooler.id}/control`).set('Cookie', admin).set(CSRF).send({ action: 'restart' }).expect(201);
    expect(queued.body.status).toBe('PENDING');
    expect(queued.body.type).toBe('service.restart');
    await request(server()).post(`/api/v1/servers/${a.serverId}/services/${spooler.id}/control`).set('Cookie', admin).set(CSRF).send({ action: 'stop' }).expect(409);

    const hb = await signed(a, '/api/v1/agents/heartbeat', { agentVersion: '0.1.0', host: HOST }).expect(200);
    expect(hb.body.commands).toHaveLength(1);
    expect(hb.body.commands[0]).toMatchObject({ id: queued.body.id, type: 'service.restart', payload: { serviceName: 'Spooler' } });
    const hb2 = await signed(a, '/api/v1/agents/heartbeat', { agentVersion: '0.1.0', host: HOST }).expect(200);
    expect(hb2.body.commands).toHaveLength(0);

    await signed(a, `/api/v1/agents/commands/${queued.body.id as string}/result`, { ok: true, message: 'Spooler: restart tamamlandı' }).expect(204);
    const commands = await request(server()).get(`/api/v1/services/commands?serverId=${a.serverId}`).set('Cookie', admin).expect(200);
    expect(commands.body[0].status).toBe('SUCCEEDED');
    expect(commands.body[0].requestedBy).toBe('İlk Yönetici');
    expect(commands.body[0].result).toContain('tamamlandı');
    await signed(a, `/api/v1/agents/commands/00000000-0000-4000-8000-000000000000/result`, { ok: false }).expect(404);

    const audit = await prisma.auditLog.findMany({ where: { action: { in: ['service.restart', 'service.command_result'] } } });
    expect(audit).toHaveLength(2);
  });

  it('işlem kayıtları filtrelenir ve yalnızca okunur', async () => {
    await request(server()).post('/api/v1/auth/login').send({ email: ADMIN.email, password: 'yanlis-parola-1' }).expect(401);
    const all = await request(server()).get('/api/v1/audit-logs').set('Cookie', admin).expect(200);
    expect(all.body.total).toBeGreaterThanOrEqual(2);
    const failed = await request(server()).get('/api/v1/audit-logs?result=FAILURE').set('Cookie', admin).expect(200);
    expect(failed.body.items.every((l: { result: string }) => l.result === 'FAILURE')).toBe(true);
    expect(failed.body.items[0].action).toBe('user.login');
    expect(failed.body.items[0].resultLabel).toBe('Başarısız');
    const search = await request(server()).get('/api/v1/audit-logs?search=user.setup').set('Cookie', admin).expect(200);
    expect(search.body.total).toBe(1);
    const meta = await request(server()).get('/api/v1/audit-logs/meta').set('Cookie', admin).expect(200);
    expect(meta.body.actions).toContain('user.login');
    await request(server()).delete('/api/v1/audit-logs/1').set('Cookie', admin).set(CSRF).expect(404);

    await request(server()).post('/api/v1/users').set('Cookie', admin).set(CSRF).send({ email: 'izleyici@ornek.com', fullName: 'İzleyici', password: 'IzleyiciParola123', role: 'VIEWER' }).expect(201);
    const login = await request(server()).post('/api/v1/auth/login').send({ email: 'izleyici@ornek.com', password: 'IzleyiciParola123' }).expect(200);
    const viewer = `tm_session=${extractCookie(login.headers['set-cookie'], 'tm_session')}`;
    await request(server()).get('/api/v1/audit-logs').set('Cookie', viewer).expect(403);
  });

  it('API belirteci oluşturulur, bearer ile kapsamlı erişim sağlar ve iptal edilir', async () => {
    const scopes = await request(server()).get('/api/v1/api-tokens/meta/scopes').set('Cookie', admin).expect(200);
    expect(scopes.body.length).toBeGreaterThan(10);

    const created = await request(server()).post('/api/v1/api-tokens').set('Cookie', admin).set(CSRF).send({ name: 'CI okuma', scopes: ['servers.read', 'dashboard.read'], expiresInDays: 30 }).expect(201);
    const token = created.body.token as string;
    expect(token).toMatch(/^tmk_/);
    expect(created.body.record.tokenPrefix).toBe(token.slice(0, 12));
    expect(created.body.record.status).toBe('ACTIVE');

    // Kapsam dahilindeki uç nokta çalışır, dışındaki 403 döner; CSRF başlığı gerekmez.
    await request(server()).get('/api/v1/servers').set('Authorization', `Bearer ${token}`).expect(200);
    const forbidden = await request(server()).get('/api/v1/users').set('Authorization', `Bearer ${token}`).expect(403);
    expect(forbidden.body.code).toBe('AUTH_FORBIDDEN');
    const me = await request(server()).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
    expect(me.body.permissions).toEqual(['dashboard.read', 'servers.read']);
    await request(server()).get('/api/v1/servers').set('Authorization', 'Bearer tmk_gecersiz').expect(401);

    const list = await request(server()).get('/api/v1/api-tokens').set('Cookie', admin).expect(200);
    expect(list.body).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain(token.slice(12));
    expect(list.body[0].lastUsedAt).toBeTruthy();

    // İzleyici kendi izinleri dışında kapsam isteyemez.
    await request(server()).post('/api/v1/users').set('Cookie', admin).set(CSRF).send({ email: 'izleyici@ornek.com', fullName: 'İzleyici', password: 'IzleyiciParola123', role: 'VIEWER' }).expect(201);
    const login = await request(server()).post('/api/v1/auth/login').send({ email: 'izleyici@ornek.com', password: 'IzleyiciParola123' }).expect(200);
    const viewer = `tm_session=${extractCookie(login.headers['set-cookie'], 'tm_session')}`;
    const exceeds = await request(server()).post('/api/v1/api-tokens').set('Cookie', viewer).set(CSRF).send({ name: 'x', scopes: ['users.manage'] }).expect(403);
    expect(exceeds.body.code).toBe('API_TOKEN_SCOPE_EXCEEDS');
    const viewerToken = await request(server()).post('/api/v1/api-tokens').set('Cookie', viewer).set(CSRF).send({ name: 'izleyici', scopes: ['servers.read'] }).expect(201);
    const viewerList = await request(server()).get('/api/v1/api-tokens?all=true').set('Cookie', viewer).expect(200);
    expect(viewerList.body).toHaveLength(1);
    const adminAll = await request(server()).get('/api/v1/api-tokens?all=true').set('Cookie', admin).expect(200);
    expect(adminAll.body).toHaveLength(2);
    await request(server()).delete(`/api/v1/api-tokens/${created.body.record.id as string}`).set('Cookie', viewer).set(CSRF).expect(403);

    await request(server()).delete(`/api/v1/api-tokens/${created.body.record.id as string}`).set('Cookie', admin).set(CSRF).expect(204);
    const revoked = await request(server()).get('/api/v1/servers').set('Authorization', `Bearer ${token}`).expect(401);
    expect(revoked.body.code).toBe('API_TOKEN_INVALID');
    await request(server()).delete(`/api/v1/api-tokens/${viewerToken.body.record.id as string}`).set('Cookie', admin).set(CSRF).expect(204);
    const audit = await prisma.auditLog.findMany({ where: { action: { in: ['api_token.create', 'api_token.revoke'] } } });
    expect(audit).toHaveLength(4);
  });
});
