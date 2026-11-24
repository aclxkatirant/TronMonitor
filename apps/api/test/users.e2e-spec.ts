import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, extractCookie } from './setup-e2e';

const CSRF = { 'X-Requested-With': 'XMLHttpRequest' };
const ADMIN = { email: 'admin@ornek.com', fullName: 'İlk Yönetici', password: 'CokGizliParola123' };

describe('Kullanıcı yönetimi ve yetkilendirme (e2e)', () => {
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

  async function loginAs(email: string, password: string): Promise<string> {
    const res = await request(server()).post('/api/v1/auth/login').send({ email, password }).expect(200);
    return `tm_session=${extractCookie(res.headers['set-cookie'], 'tm_session')}`;
  }

  async function setupAdmin(): Promise<string> {
    const res = await request(server()).post('/api/v1/auth/register').send(ADMIN).expect(201);
    return `tm_session=${extractCookie(res.headers['set-cookie'], 'tm_session')}`;
  }

  it('süper yönetici kullanıcı oluşturur, izleyici yetkisizdir', async () => {
    const admin = await setupAdmin();

    const created = await request(server())
      .post('/api/v1/users')
      .set('Cookie', admin)
      .set(CSRF)
      .send({ email: 'izleyici@ornek.com', fullName: 'İzleyici Kullanıcı', password: 'IzleyiciParola123', role: 'VIEWER' })
      .expect(201);
    expect(created.body.roleLabel).toBe('İzleyici');

    const viewer = await loginAs('izleyici@ornek.com', 'IzleyiciParola123');
    const forbidden = await request(server()).get('/api/v1/users').set('Cookie', viewer).expect(403);
    expect(forbidden.body.code).toBe('AUTH_FORBIDDEN');

    await request(server())
      .post('/api/v1/users')
      .set('Cookie', viewer)
      .set(CSRF)
      .send({ email: 'x@ornek.com', fullName: 'X Y', password: 'ParolaParola123', role: 'ADMIN' })
      .expect(403);

    const list = await request(server()).get('/api/v1/users?search=izleyici').set('Cookie', admin).expect(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].email).toBe('izleyici@ornek.com');
  });

  it('operatöre açıkça atanan izinler etkin izinlere eklenir', async () => {
    const admin = await setupAdmin();
    await request(server())
      .post('/api/v1/users')
      .set('Cookie', admin)
      .set(CSRF)
      .send({ email: 'op@ornek.com', fullName: 'Operatör', password: 'OperatorParola123', role: 'OPERATOR', permissions: ['terminal.use'] })
      .expect(201);

    const op = await loginAs('op@ornek.com', 'OperatorParola123');
    const me = await request(server()).get('/api/v1/auth/me').set('Cookie', op).expect(200);
    expect(me.body.permissions).toContain('terminal.use');
    expect(me.body.permissions).toContain('incidents.manage');
    expect(me.body.permissions).not.toContain('servers.manage');
  });

  it('yönetici süper yönetici oluşturamaz veya düzenleyemez', async () => {
    const superAdmin = await setupAdmin();
    await request(server())
      .post('/api/v1/users')
      .set('Cookie', superAdmin)
      .set(CSRF)
      .send({ email: 'yonetici@ornek.com', fullName: 'Yönetici', password: 'YoneticiParola123', role: 'ADMIN' })
      .expect(201);
    const admin = await loginAs('yonetici@ornek.com', 'YoneticiParola123');

    await request(server())
      .post('/api/v1/users')
      .set('Cookie', admin)
      .set(CSRF)
      .send({ email: 'sa2@ornek.com', fullName: 'Süper İki', password: 'SuperParola12345', role: 'SUPER_ADMIN' })
      .expect(403);

    const superUser = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN.email } });
    await request(server()).patch(`/api/v1/users/${superUser.id}`).set('Cookie', admin).set(CSRF).send({ isActive: false }).expect(403);

    // Yönetici kendi rolünü değiştiremez.
    const adminUser = await prisma.user.findUniqueOrThrow({ where: { email: 'yonetici@ornek.com' } });
    const self = await request(server()).patch(`/api/v1/users/${adminUser.id}`).set('Cookie', admin).set(CSRF).send({ role: 'OPERATOR' }).expect(403);
    expect(self.body.code).toBe('USER_CANNOT_MODIFY_SELF_ROLE');
  });

  it('kullanıcı kendini devre dışı bırakamaz; devre dışı bırakma oturumları kapatır', async () => {
    const superAdmin = await setupAdmin();
    const superUser = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN.email } });
    const last = await request(server()).patch(`/api/v1/users/${superUser.id}`).set('Cookie', superAdmin).set(CSRF).send({ isActive: false }).expect(403);
    expect(last.body.code).toBe('USER_CANNOT_MODIFY_SELF_ROLE');

    await request(server())
      .post('/api/v1/users')
      .set('Cookie', superAdmin)
      .set(CSRF)
      .send({ email: 'gecici@ornek.com', fullName: 'Geçici', password: 'GeciciParola1234', role: 'VIEWER' })
      .expect(201);
    const viewer = await loginAs('gecici@ornek.com', 'GeciciParola1234');
    const viewerUser = await prisma.user.findUniqueOrThrow({ where: { email: 'gecici@ornek.com' } });

    await request(server()).patch(`/api/v1/users/${viewerUser.id}`).set('Cookie', superAdmin).set(CSRF).send({ isActive: false }).expect(200);
    await request(server()).get('/api/v1/auth/me').set('Cookie', viewer).expect(401);

    const audit = await prisma.auditLog.findMany({ where: { action: 'user.update' } });
    expect(audit).toHaveLength(1);
    expect(audit[0].resourceId).toBe(viewerUser.id);
  });

  it('bilinmeyen kullanıcı ve geçersiz kimlik 404 döner', async () => {
    const admin = await setupAdmin();
    await request(server()).get('/api/v1/users/00000000-0000-0000-0000-000000000000').set('Cookie', admin).expect(404);
    await request(server()).get('/api/v1/users/gecersiz').set('Cookie', admin).expect(404);
  });
});
