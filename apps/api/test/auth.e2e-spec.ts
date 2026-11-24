import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, extractCookie } from './setup-e2e';

const CSRF = { 'X-Requested-With': 'XMLHttpRequest' };
const ADMIN = { email: 'admin@ornek.com', fullName: 'İlk Yönetici', password: 'CokGizliParola123' };

describe('Kimlik doğrulama (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let reset: () => Promise<void>;

  beforeAll(async () => {
    ({ app, prisma, reset } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await reset();
  });

  const server = () => app.getHttpServer() as Parameters<typeof request>[0];

  async function setupAdmin(): Promise<string> {
    const res = await request(server()).post('/api/v1/auth/register').set(CSRF).send(ADMIN).expect(201);
    const cookie = extractCookie(res.headers['set-cookie'], 'tm_session');
    expect(cookie).toBeTruthy();
    return `tm_session=${cookie}`;
  }

  it('sağlık ucu herkese açıktır', async () => {
    const res = await request(server()).get('/api/v1/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.checks).toEqual({ database: 'ok', redis: 'ok' });
  });

  it('ilk kayıt süper yönetici oluşturur ve sonraki kayıtlar kapalıdır', async () => {
    const status = await request(server()).get('/api/v1/auth/status').expect(200);
    expect(status.body).toEqual({ setupRequired: true, selfRegistrationEnabled: false });

    const res = await request(server()).post('/api/v1/auth/register').send(ADMIN).expect(201);
    expect(res.body.user.role).toBe('SUPER_ADMIN');
    expect(res.body.user.permissions).toContain('settings.manage');
    expect(res.headers['set-cookie'][0]).toMatch(/HttpOnly/);
    expect(res.headers['set-cookie'][0]).toMatch(/SameSite=Lax/);

    const closed = await request(server())
      .post('/api/v1/auth/register')
      .send({ email: 'ikinci@ornek.com', fullName: 'İkinci', password: 'BaskaParola1234' })
      .expect(403);
    expect(closed.body.code).toBe('AUTH_REGISTRATION_CLOSED');

    const audit = await prisma.auditLog.findMany({ orderBy: { id: 'asc' } });
    expect(audit.map((a) => `${a.action}:${a.result}`)).toEqual(['user.setup:SUCCESS', 'user.register:DENIED']);
  });

  it('kendi kendine kayıt ayarı açıkken izleyici oluşturur', async () => {
    await setupAdmin();
    await prisma.systemSetting.create({ data: { key: 'auth.allowSelfRegistration', value: true } });
    const res = await request(server())
      .post('/api/v1/auth/register')
      .send({ email: 'izleyici@ornek.com', fullName: 'İzleyici', password: 'IzleyiciParola123' })
      .expect(201);
    expect(res.body.user.role).toBe('VIEWER');
    expect(res.body.user.permissions).not.toContain('terminal.use');
  });

  it('zayıf parola ve geçersiz e-posta reddedilir', async () => {
    const res = await request(server())
      .post('/api/v1/auth/register')
      .send({ email: 'gecersiz', fullName: 'A', password: 'kisa' })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.details.length).toBeGreaterThanOrEqual(3);
  });

  it('bilinmeyen alanlar reddedilir', async () => {
    await request(server())
      .post('/api/v1/auth/login')
      .send({ email: ADMIN.email, password: ADMIN.password, role: 'SUPER_ADMIN' })
      .expect(400);
  });

  it('giriş, profil, CSRF ve çıkış akışı çalışır', async () => {
    await setupAdmin();

    const wrong = await request(server()).post('/api/v1/auth/login').send({ email: ADMIN.email, password: 'yanlis-parola-1' }).expect(401);
    expect(wrong.body.code).toBe('AUTH_INVALID_CREDENTIALS');

    const unknown = await request(server()).post('/api/v1/auth/login').send({ email: 'yok@ornek.com', password: 'yanlis-parola-1' }).expect(401);
    expect(unknown.body.code).toBe('AUTH_INVALID_CREDENTIALS');

    const login = await request(server()).post('/api/v1/auth/login').send({ email: ADMIN.email.toUpperCase(), password: ADMIN.password }).expect(200);
    const cookie = `tm_session=${extractCookie(login.headers['set-cookie'], 'tm_session')}`;

    await request(server()).get('/api/v1/auth/me').expect(401);
    const me = await request(server()).get('/api/v1/auth/me').set('Cookie', cookie).expect(200);
    expect(me.body.email).toBe(ADMIN.email);
    expect(me.body.roleLabel).toBe('Süper Yönetici');

    // CSRF: çerezle gelen değiştirici istek başlıksız reddedilir.
    const csrf = await request(server()).post('/api/v1/auth/logout').set('Cookie', cookie).expect(403);
    expect(csrf.body.code).toBe('AUTH_CSRF');

    await request(server()).post('/api/v1/auth/logout').set('Cookie', cookie).set(CSRF).expect(204);
    const after = await request(server()).get('/api/v1/auth/me').set('Cookie', cookie).expect(401);
    expect(after.body.code).toBe('AUTH_SESSION_EXPIRED');

    const user = await prisma.user.findUnique({ where: { email: ADMIN.email } });
    expect(user?.lastLoginAt).toBeTruthy();
  });

  it('devre dışı hesap giriş yapamaz', async () => {
    await setupAdmin();
    await prisma.user.update({ where: { email: ADMIN.email }, data: { isActive: false } });
    const res = await request(server()).post('/api/v1/auth/login').send({ email: ADMIN.email, password: ADMIN.password }).expect(403);
    expect(res.body.code).toBe('AUTH_ACCOUNT_DISABLED');
  });

  it('parola değişikliği diğer oturumları kapatır', async () => {
    const cookie1 = await setupAdmin();
    const login2 = await request(server()).post('/api/v1/auth/login').send({ email: ADMIN.email, password: ADMIN.password }).expect(200);
    const cookie2 = `tm_session=${extractCookie(login2.headers['set-cookie'], 'tm_session')}`;

    const sessions = await request(server()).get('/api/v1/auth/sessions').set('Cookie', cookie1).expect(200);
    expect(sessions.body).toHaveLength(2);
    expect(sessions.body.filter((s: { isCurrent: boolean }) => s.isCurrent)).toHaveLength(1);

    const bad = await request(server())
      .post('/api/v1/auth/change-password')
      .set('Cookie', cookie1)
      .set(CSRF)
      .send({ currentPassword: 'yanlis-parola-1', newPassword: 'YeniParola12345' })
      .expect(400);
    expect(bad.body.code).toBe('AUTH_CURRENT_PASSWORD_WRONG');

    const ok = await request(server())
      .post('/api/v1/auth/change-password')
      .set('Cookie', cookie1)
      .set(CSRF)
      .send({ currentPassword: ADMIN.password, newPassword: 'YeniParola12345' })
      .expect(200);
    expect(ok.body.revokedSessions).toBe(1);

    await request(server()).get('/api/v1/auth/me').set('Cookie', cookie1).expect(200);
    await request(server()).get('/api/v1/auth/me').set('Cookie', cookie2).expect(401);
    await request(server()).post('/api/v1/auth/login').send({ email: ADMIN.email, password: ADMIN.password }).expect(401);
    await request(server()).post('/api/v1/auth/login').send({ email: ADMIN.email, password: 'YeniParola12345' }).expect(200);
  });

  it('belirli bir oturum sonlandırılabilir', async () => {
    const cookie1 = await setupAdmin();
    const login2 = await request(server()).post('/api/v1/auth/login').send({ email: ADMIN.email, password: ADMIN.password }).expect(200);
    const cookie2 = `tm_session=${extractCookie(login2.headers['set-cookie'], 'tm_session')}`;

    const sessions = await request(server()).get('/api/v1/auth/sessions').set('Cookie', cookie1).expect(200);
    const other = sessions.body.find((s: { isCurrent: boolean }) => !s.isCurrent) as { id: string };
    await request(server()).delete(`/api/v1/auth/sessions/${other.id}`).set('Cookie', cookie1).set(CSRF).expect(204);
    await request(server()).get('/api/v1/auth/me').set('Cookie', cookie2).expect(401);
    await request(server()).delete(`/api/v1/auth/sessions/${other.id}`).set('Cookie', cookie1).set(CSRF).expect(404);
  });

  it('giriş denemeleri hız sınırına tabidir', async () => {
    await setupAdmin();
    for (let i = 0; i < 5; i += 1) {
      await request(server()).post('/api/v1/auth/login').send({ email: ADMIN.email, password: 'yanlis-parola-1' }).expect(401);
    }
    const limited = await request(server()).post('/api/v1/auth/login').send({ email: ADMIN.email, password: ADMIN.password }).expect(429);
    expect(limited.body.code).toBe('AUTH_RATE_LIMITED');
  });
});
