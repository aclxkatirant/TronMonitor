import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { AppConfigService } from './config/config.service';
import { API_PREFIX, APP_VERSION } from './version';

async function bootstrap(): Promise<void> {
  // rawBody: ajan isteklerinin HMAC imzası ham gövde üzerinden doğrulanır.
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  configureApp(app);

  const config = app.get(AppConfigService);
  const host = config.get('API_HOST');
  const port = config.get('API_PORT');
  await app.listen(port, host);

  const logger = new Logger('TronMonitor');
  logger.log(`TronMonitor API v${APP_VERSION} http://${host}:${port}/${API_PREFIX} adresinde dinliyor`);
  if (!config.isProduction) {
    logger.log(`API belgeleri: http://${host}:${port}/api/docs`);
  }
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  // Başlangıç hataları için logger henüz hazır olmayabilir.
  console.error(`TronMonitor API başlatılamadı:\n${message}`);
  process.exit(1);
});
