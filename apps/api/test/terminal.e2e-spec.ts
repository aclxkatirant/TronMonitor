import type { INestApplication } from '@nestjs/common';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { Server as SshServer } from 'ssh2';
import WebSocket from 'ws';
import type { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { ServicesService } from '../src/services/services.service';
import { signRequest } from '../src/agents/agent-signing';
import { createTestApp, extractCookie } from './setup-e2e';

const CSRF = { 'X-Requested-With': 'XMLHttpRequest' };
const ADMIN = { email: 'admin@ornek.com', fullName: 'İlk Yönetici', password: 'CokGizliParola123' };
const HOST = { hostname: 'linux-01', osFamily: 'LINUX', osName: 'Ubuntu 24.04', architecture: 'amd64', cpuCores: 2, totalMemoryBytes: 4e9 };
const SSH_USER = { username: 'tron', password: 'gizli-parola' };

type Msg = Record<string, unknown>;

/** Test için küçük bir SSH sunucusu: parola doğrular, PTY kabuğu girdiyi yankılar ve her satıra "OK" yazar. */
function startSshServer(): Promise<{ port: number; close: () => void }> {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'pkcs1', format: 'pem' } });
  const server = new SshServer({ hostKeys: [privateKey] }, (client) => {
    client.on('authentication', (ctx) => {
      if (ctx.method === 'password' && ctx.username === SSH_USER.username && ctx.password === SSH_USER.password) ctx.accept();
      else ctx.reject(['password']);
    });
    client.on('ready', () => {
      client.on('session', (accept) => {
        const session = accept();
        session.on('pty', (acceptPty) => acceptPty?.());
        session.on('window-change', (acceptWc) => acceptWc?.());
        session.on('shell', (acceptShell) => {
          const stream = acceptShell();
          stream.write('hosgeldin\r\n$ ');
          stream.on('data', (data: Buffer) => {
            stream.write(data);
            const text = data.toString('utf8');
            if (text.includes('\r')) stream.write('\r\nOK\r\n$ ');
            if (text.includes('exit')) {
              stream.exit(0);
              stream.end();
            }
          });
        });
      });
    });
    client.on('error', () => undefined);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ port: (server.address() as AddressInfo).port, close: () => server.close() }));
  });
}

describe('Terminal (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let reset: () => Promise<void>;
  let admin: string;
  let baseUrl: string;
  let ssh: { port: number; close: () => void };

  beforeAll(async () => {
    ({ app, prisma, reset } = await createTestApp());
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `127.0.0.1:${address.port}`;
    ssh = await startSshServer();
  });
  afterAll(async () => {
    ssh.close();
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
    const tokenRes = await request(server()).post('/api/v1/registration-tokens').set('Cookie', admin).set(CSRF).send({ osFamily: 'LINUX', serverName: 'Linux Sunucusu' }).expect(201);
    const reg = await request(server()).post('/api/v1/agents/register').send({ registrationToken: tokenRes.body.token, agentVersion: '0.3.0', host: HOST }).expect(201);
    return reg.body as { serverId: string; agentId: string; keyId: string; secret: string };
  }

  function signedGet(creds: { keyId: string; secret: string }, path: string) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = randomBytes(16).toString('hex');
    return request(server())
      .get(path)
      .set('X-Agent-Key', creds.keyId)
      .set('X-Agent-Timestamp', timestamp)
      .set('X-Agent-Nonce', nonce)
      .set('X-Agent-Signature', signRequest(creds.secret, { method: 'GET', requestUri: path, timestamp, nonce, body: '' }));
  }

  /** Tarayıcı terminal soketi: JSON mesajları ve ikili çıktıyı kuyruklar, beklenen mesajı bekler. */
  function openTerminalSocket() {
    const socket = new WebSocket(`ws://${baseUrl}/api/v1/terminal`, { headers: { Cookie: admin } });
    const messages: Msg[] = [];
    let output = '';
    const waiters: { test: () => boolean; resolve: () => void }[] = [];
    const check = () => {
      for (const w of [...waiters]) if (w.test()) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve();
      }
    };
    socket.on('message', (raw: Buffer, isBinary: boolean) => {
      if (isBinary) output += raw.toString('utf8');
      else messages.push(JSON.parse(raw.toString('utf8')) as Msg);
      check();
    });
    const waitFor = (test: () => boolean, label: string, timeoutMs = 10_000) =>
      new Promise<void>((resolve, reject) => {
        if (test()) return resolve();
        const timer = setTimeout(() => reject(new Error(`${label} zamanında gelmedi; mesajlar=${JSON.stringify(messages)} çıktı=${JSON.stringify(output)}`)), timeoutMs);
        waiters.push({ test, resolve: () => (clearTimeout(timer), resolve()) });
      });
    const waitMessage = (type: string) => waitFor(() => messages.some((m) => m.type === type), `'${type}' mesajı`).then(() => messages.find((m) => m.type === type)!);
    const waitOutput = (text: string) => waitFor(() => output.includes(text), `'${text}' çıktısı`);
    const opened = new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    return { socket, opened, messages, waitMessage, waitOutput, send: (msg: Msg) => socket.send(JSON.stringify(msg)), output: () => output };
  }

  it('SSH kimlik bilgisi kaydedilir, maskeli okunur, geçersiz anahtar reddedilir ve silinir', async () => {
    const a = await registerServer();
    const put = await request(server()).put(`/api/v1/servers/${a.serverId}/credential`).set('Cookie', admin).set(CSRF).send({ type: 'SSH_PASSWORD', username: SSH_USER.username, host: '127.0.0.1', port: ssh.port, password: SSH_USER.password }).expect(200);
    expect(put.body).toMatchObject({ type: 'SSH_PASSWORD', username: SSH_USER.username, host: '127.0.0.1', port: ssh.port, hostFingerprint: null });
    expect(JSON.stringify(put.body)).not.toContain(SSH_USER.password);

    const get = await request(server()).get(`/api/v1/servers/${a.serverId}/credential`).set('Cookie', admin).expect(200);
    expect(get.body.username).toBe(SSH_USER.username);
    expect(get.body.encryptedSecret).toBeUndefined();

    const badKey = await request(server()).put(`/api/v1/servers/${a.serverId}/credential`).set('Cookie', admin).set(CSRF).send({ type: 'SSH_KEY', username: 'root', privateKey: 'bu bir anahtar değil' }).expect(400);
    expect(badKey.body.code).toBe('TERMINAL_KEY_INVALID');
    const incomplete = await request(server()).put(`/api/v1/servers/${a.serverId}/credential`).set('Cookie', admin).set(CSRF).send({ type: 'SSH_KEY', username: 'root' }).expect(400);
    expect(incomplete.body.code).toBe('TERMINAL_CREDENTIAL_INCOMPLETE');

    const servers = await request(server()).get('/api/v1/terminal/servers').set('Cookie', admin).expect(200);
    expect(servers.body[0].methods).toContain('SSH');
    expect(servers.body[0].credential.username).toBe(SSH_USER.username);

    await request(server()).delete(`/api/v1/servers/${a.serverId}/credential`).set('Cookie', admin).set(CSRF).expect(204);
    const after = await request(server()).get(`/api/v1/servers/${a.serverId}/credential`).set('Cookie', admin).expect(200);
    expect(after.body).toEqual({});
    const audit = await request(server()).get('/api/v1/audit-logs?action=terminal.credential.create').set('Cookie', admin).expect(200);
    expect(audit.body.total).toBe(1);
  });

  it('ajan komut uzun yoklaması: bekleyen komut hemen, yeni komut sinyalle döner', async () => {
    const a = await registerServer();
    const services = app.get(ServicesService);
    await services.enqueueCommand(a.agentId, 'service.start', { serviceName: 'ssh' }, null);
    const immediate = await signedGet(a, '/api/v1/agents/commands/wait').expect(200);
    expect(immediate.body).toHaveLength(1);
    expect(immediate.body[0].type).toBe('service.start');

    // Bekleyen komut yokken yoklama askıda kalır; yeni komut gelince (Redis sinyali) hemen döner.
    const started = Date.now();
    const waiting = signedGet(a, '/api/v1/agents/commands/wait').expect(200);
    await new Promise((r) => setTimeout(r, 300));
    await services.enqueueCommand(a.agentId, 'service.restart', { serviceName: 'nginx' }, null);
    const res = await waiting;
    expect(res.body[0].type).toBe('service.restart');
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('tarayıcı terminali: yöntem yoksa reddedilir; SSH oturumu açılır, komutlar kaydedilir, anahtar uyuşmazlığı engellenir', async () => {
    const a = await registerServer();

    // Kimlik bilgisi yokken SSH istenirse yöntem yok.
    const none = openTerminalSocket();
    await none.opened;
    await none.waitMessage('hello');
    none.send({ type: 'open', serverId: a.serverId, protocol: 'SSH', cols: 100, rows: 30 });
    const err = await none.waitMessage('error');
    expect(err.code).toBe('TERMINAL_NO_METHOD');
    none.socket.close();

    await request(server()).put(`/api/v1/servers/${a.serverId}/credential`).set('Cookie', admin).set(CSRF).send({ type: 'SSH_PASSWORD', username: SSH_USER.username, host: '127.0.0.1', port: ssh.port, password: SSH_USER.password }).expect(200);

    const t = openTerminalSocket();
    await t.opened;
    await t.waitMessage('hello');
    t.send({ type: 'open', serverId: a.serverId, protocol: 'SSH', cols: 100, rows: 30 });
    const ready = await t.waitMessage('ready');
    expect(ready.protocol).toBe('SSH');
    await t.waitOutput('hosgeldin');
    t.send({ type: 'input', data: 'echo merhaba\r' });
    await t.waitOutput('OK');
    t.send({ type: 'resize', cols: 120, rows: 40 });
    t.send({ type: 'input', data: 'uptime' });
    t.send({ type: 'close' });
    const exit = await t.waitMessage('exit');
    expect(exit.status).toBe('CLOSED');

    const sessions = await request(server()).get('/api/v1/terminal/sessions').set('Cookie', admin).expect(200);
    expect(sessions.body.total).toBe(1);
    const closed = sessions.body.items.find((s: { status: string }) => s.status === 'CLOSED');
    expect(closed.protocol).toBe('SSH');
    expect(closed.commandCount).toBe(2);
    const commands = await request(server()).get(`/api/v1/terminal/sessions/${closed.id}/commands`).set('Cookie', admin).expect(200);
    expect(commands.body.map((c: { command: string }) => c.command)).toEqual(['echo merhaba', 'uptime']);

    // İlk bağlantıda sunucu anahtarı öğrenildi (TOFU).
    const cred = await request(server()).get(`/api/v1/servers/${a.serverId}/credential`).set('Cookie', admin).expect(200);
    expect(cred.body.hostFingerprint).toMatch(/^SHA256:/);

    // Kayıtlı parmak izi değişirse bağlantı reddedilir.
    await prisma.serverCredential.updateMany({ where: { serverId: a.serverId }, data: { hostFingerprint: 'SHA256:sahte' } });
    const m = openTerminalSocket();
    await m.opened;
    await m.waitMessage('hello');
    m.send({ type: 'open', serverId: a.serverId, protocol: 'SSH' });
    const mismatch = await m.waitMessage('exit');
    expect(mismatch.status).toBe('FAILED');
    expect(mismatch.code).toBe('TERMINAL_HOST_KEY_MISMATCH');

    const audit = await request(server()).get('/api/v1/audit-logs?action=terminal.open').set('Cookie', admin).expect(200);
    expect(audit.body.total).toBe(2);
    await request(server()).post(`/api/v1/terminal/sessions/${closed.id}/terminate`).set('Cookie', admin).set(CSRF).expect(409);
  });
});
