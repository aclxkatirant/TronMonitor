import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { WsAdapter } from '@nestjs/platform-ws';
import cookieParser from 'cookie-parser';
import type { Express } from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppConfigService } from './config/config.service';
import { API_PREFIX, APP_VERSION } from './version';

// BigInt alanları JSON'a dize olarak yazılır (metrik ve sayaç alanları için).
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function toJSON(this: bigint): string {
  return this.toString();
};

/**
 * Uygulama ara katmanlarını ve genel ayarları kurar. Hem main.ts hem de e2e testleri tarafından kullanılır.
 */
export function configureApp(app: INestApplication): void {
  const config = app.get(AppConfigService);

  app.useLogger(app.get(Logger));
  app.setGlobalPrefix(API_PREFIX);
  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableShutdownHooks();
  const express = app.getHttpAdapter().getInstance() as Express;
  express.set('trust proxy', 'loopback');

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cookieParser());
  app.enableCors({
    origin: config.get('WEB_ORIGIN'),
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      stopAtFirstError: false,
    }),
  );

  if (!config.isProduction) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('TronMonitor API')
        .setDescription('TronMonitor merkezi arka uç API belgeleri')
        .setVersion(APP_VERSION)
        .addCookieAuth('tm_session')
        .build(),
    );
    SwaggerModule.setup('api/docs', app, document, { customSiteTitle: 'TronMonitor API' });
  }
}
