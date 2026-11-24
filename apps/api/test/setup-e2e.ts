import 'dotenv/config';
import { execSync } from 'node:child_process';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ThrottlerStorage, type ThrottlerStorageService } from '@nestjs/throttler';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
  /** Veritabanı tablolarını ve hız sınırı sayaçlarını sıfırlar. */
  reset: () => Promise<void>;
}

/**
 * Uçtan uca testler ayrı bir test veritabanı kullanır (TEST_DATABASE_URL). Göçler her çalıştırmada uygulanır
 * ve tablolar temizlenir.
 */
export async function createTestApp(): Promise<TestContext> {
  process.env.NODE_ENV = 'test';
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) throw new Error('TEST_DATABASE_URL tanımlı değil; e2e testleri için gereklidir.');
  if (!/_test(\?|$)/.test(testUrl)) {
    throw new Error('TEST_DATABASE_URL güvenlik için "_test" ile biten bir veritabanına işaret etmelidir.');
  }

  execSync('npx prisma migrate deploy', {
    cwd: `${__dirname}/..`,
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: testUrl },
  });

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ bufferLogs: false, logger: false, rawBody: true });
  configureApp(app);
  await app.init();

  const prisma = app.get(PrismaService);
  const throttler = app.get<ThrottlerStorageService>(ThrottlerStorage);

  const reset = async (): Promise<void> => {
    await resetDatabase(prisma);
    // Bellek içi throttler deposu iki harita tutar; ikisi de temizlenmezse sayaçlar geri yüklenir.
    throttler.storage.clear();
    (throttler as unknown as { hitExpirations: Map<string, unknown> }).hitExpirations.clear();
  };
  await reset();
  return { app, prisma, reset };
}

export async function resetDatabase(prisma: PrismaService): Promise<void> {
  // Kalıcı katalog tabloları (Permission, RolePermission) korunur.
  await prisma.auditLog.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.notificationChannel.deleteMany();
  await prisma.monitoringCheck.deleteMany();
  await prisma.incident.deleteMany();
  await prisma.metricAggregate.deleteMany();
  await prisma.server.deleteMany();
  await prisma.registrationToken.deleteMany();
  await prisma.serverGroup.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.userSession.deleteMany();
  await prisma.apiToken.deleteMany();
  await prisma.userPermission.deleteMany();
  await prisma.systemSetting.deleteMany();
  await prisma.user.deleteMany();
}

export function extractCookie(setCookie: string | string[] | undefined, name: string): string | null {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  for (const entry of list) {
    const [pair] = entry.split(';');
    const [key, value] = pair.split('=');
    if (key === name) return value ?? '';
  }
  return null;
}
