import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigModule } from './config/config.module';
import { AppConfigService } from './config/config.service';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { AuditModule } from './audit/audit.module';
import { PermissionsModule } from './permissions/permissions.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { RegistrationModule } from './registration/registration.module';
import { AgentsModule } from './agents/agents.module';
import { EncryptionModule } from './common/encryption.module';
import { RealtimeModule } from './realtime/realtime.module';
import { ServersModule } from './servers/servers.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { AgentDownloadsModule } from './agent-downloads/agent-downloads.module';
import { QueueModule } from './queue/queue.module';
import { SettingsModule } from './settings/settings.module';
import { MetricsModule } from './metrics/metrics.module';
import { NotificationsModule } from './notifications/notifications.module';
import { IncidentsModule } from './incidents/incidents.module';
import { UptimeModule } from './uptime/uptime.module';
import { ServicesModule } from './services/services.module';
import { TerminalModule } from './terminal/terminal.module';
import { ApiTokensModule } from './api-tokens/api-tokens.module';
import { HealthController } from './health/health.controller';
import { GlobalExceptionFilter } from './common/http-exception.filter';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        pinoHttp: {
          level: config.isTest ? 'silent' : config.get('LOG_LEVEL'),
          transport: config.isProduction || config.isTest ? undefined : { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } },
          redact: {
            paths: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
            censor: '[gizli]',
          },
          autoLogging: { ignore: (req) => req.url?.startsWith('/api/v1/health') ?? false },
        },
      }),
    }),
    ThrottlerModule.forRoot({ throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }] }),
    PrismaModule,
    RedisModule,
    AuditModule,
    PermissionsModule,
    EncryptionModule,
    ApiTokensModule,
    AuthModule,
    UsersModule,
    QueueModule,
    SettingsModule,
    RealtimeModule,
    NotificationsModule,
    IncidentsModule,
    ServicesModule,
    TerminalModule,
    RegistrationModule,
    AgentsModule,
    ServersModule,
    MetricsModule,
    UptimeModule,
    DashboardModule,
    AgentDownloadsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
