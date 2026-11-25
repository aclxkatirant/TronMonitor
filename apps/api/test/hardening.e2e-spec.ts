import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import WebSocket from 'ws';
import type { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { createTestApp, extractCookie } from './setup-e2e';

const CSRF = { 'X-Requested-With': 'XMLHttpRequest' };
const ADMIN = { email: 'admin@ornek.com', fullName: 'İlk Yönetici', password: 'CokGizliParola123' };

/** Güvenlik incelemesinden çıkan düzeltmeleri kilitleyen testler. */
describe('Sertleştirme (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let reset: () => Promise<void>;
  let superAdmin: string;
  let baseUrl: string;

  beforeAll(async () => {
    ({ app, prisma, reset } = await createTestApp());
    await app.listen(0, '127.0.0.1');
    baseUrl = `127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await reset();
    await app.get(RedisService).client.flushdb();
    const res = await request(server()).post('/api/v1/auth/register').send(ADMIN).expect(201);
    superAdmin = `tm_session=${extractCookie(res.headers['set-cookie'], 'tm_session')}`;
  });
  const server = () => app.getHttpServer() as Parameters<typeof request>[0];

  async function loginAs(email: string, password: string): Promise<string> {
    const res = await request(server()).post('/api/v1/auth/login').send({ email, password }).expect(200);
    return `tm_session=${extractCookie(res.headers['set-cookie'], 'tm_session')}`;
  }

  it('yönetici, kendi sahip olmadığı izni başka kullanıcıya veremez', async () => {
    await request(server()).post('/api/v1/users').set('Cookie', superAdmin).set(CSRF).send({ email: 'yonetici@ornek.com', fullName: 'Yönetici', password: 'YoneticiParola123', role: 'ADMIN' }).expect(201);
    const admin = await loginAs('yonetici@ornek.com', 'YoneticiParola123');
    // ADMIN varsayılanında settings.manage yoktur.
    const denied = await request(server()).post('/api/v1/users').set('Cookie', admin).set(CSRF).send({ email: 'izleyici@ornek.com', fullName: 'İzleyici', password: 'IzleyiciParola123', role: 'VIEWER', permissions: ['settings.manage'] }).expect(403);
    expect(denied.body.code).toBe('USER_PERMISSION_EXCEEDS');
    const ok = await request(server()).post('/api/v1/users').set('Cookie', admin).set(CSRF).send({ email: 'izleyici@ornek.com', fullName: 'İzleyici', password: 'IzleyiciParola123', role: 'VIEWER', permissions: ['servers.manage'] }).expect(201);
    const upd = await request(server()).patch(`/api/v1/users/${ok.body.id}`).set('Cookie', admin).set(CSRF).send({ permissions: ['settings.manage'] }).expect(403);
    expect(upd.body.code).toBe('USER_PERMISSION_EXCEEDS');
    expect(await prisma.userPermission.count({ where: { permissionKey: 'settings.manage' } })).toBe(0);
  });

  it('API belirteci hesap yönetimi uçlarını kullanamaz; kaydedilen oturumlar belirteçle kapatılamaz', async () => {
    const created = await request(server()).post('/api/v1/api-tokens').set('Cookie', superAdmin).set(CSRF).send({ name: 'tam', scopes: ['dashboard.read', 'servers.read'] }).expect(201);
    const bearer = `Bearer ${created.body.token}`;
    await request(server()).get('/api/v1/dashboard/summary').set('Authorization', bearer).expect(200);
    const pw = await request(server()).post('/api/v1/auth/change-password').set('Authorization', bearer).send({ currentPassword: ADMIN.password, newPassword: 'YeniParola12345' }).expect(403);
    expect(pw.body.code).toBe('AUTH_SESSION_REQUIRED');
    await request(server()).get('/api/v1/auth/sessions').set('Authorization', bearer).expect(403);
    await request(server()).post('/api/v1/auth/logout').set('Authorization', bearer).expect(403);
    // Parola değişmedi, oturum hâlâ geçerli.
    await request(server()).get('/api/v1/auth/me').set('Cookie', superAdmin).expect(200);
  });

  it('bozuk çerezli WebSocket el sıkışması süreci düşürmez, 4001 ile kapanır', async () => {
    const tryConnect = (path: string, cookie: string) =>
      new Promise<number>((resolve, reject) => {
        const socket = new WebSocket(`ws://${baseUrl}${path}`, { headers: { Cookie: cookie } });
        socket.on('close', (code) => resolve(code));
        socket.on('error', reject);
      });
    expect(await tryConnect('/api/v1/ws', 'tm_session=%')).toBe(4001);
    expect(await tryConnect('/api/v1/terminal', 'tm_session=%E0%A4%A')).toBe(4001);
    // Süreç ayakta ve geçerli çerezle bağlantı çalışıyor.
    await request(server()).get('/api/v1/health').expect(200);
    const hello = await new Promise<string>((resolve, reject) => {
      const socket = new WebSocket(`ws://${baseUrl}/api/v1/ws`, { headers: { Cookie: superAdmin } });
      socket.on('message', (raw: Buffer) => {
        resolve(raw.toString('utf8'));
        socket.close();
      });
      socket.on('error', reject);
    });
    expect(JSON.parse(hello).type).toBe('hello');
  });

  it('oturum iptal edilince açık pano WebSocket bağlantısı kapatılır', async () => {
    const second = await loginAs(ADMIN.email, ADMIN.password);
    const closed = new Promise<number>((resolve, reject) => {
      const socket = new WebSocket(`ws://${baseUrl}/api/v1/ws`, { headers: { Cookie: second } });
      socket.on('close', (code) => resolve(code));
      socket.on('error', reject);
      socket.on('message', () => {
        // Diğer oturumdan bu oturumu sonlandır.
        void (async () => {
          const sessions = await request(server()).get('/api/v1/auth/sessions').set('Cookie', superAdmin).expect(200);
          const other = sessions.body.find((s: { isCurrent: boolean }) => !s.isCurrent) as { id: string };
          await request(server()).delete(`/api/v1/auth/sessions/${other.id}`).set('Cookie', superAdmin).set(CSRF).expect(204);
        })().catch(reject);
      });
    });
    expect(await closed).toBe(4001);
  });

  it('ICMP hedefi "-" ile başlayamaz', async () => {
    const res = await request(server()).post('/api/v1/checks').set('Cookie', superAdmin).set(CSRF).send({ name: 'ping', type: 'ICMP', target: '-f', intervalSec: 60, timeoutSec: 5 }).expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(String(res.body.details[0])).toContain('"-"');
  });
});
