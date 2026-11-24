import { Injectable } from '@nestjs/common';
import { AuditResult, type Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { DEFAULT_MONITORING_SETTINGS, MONITORING_SETTINGS_KEY, type MonitoringSettings } from './monitoring-settings';

const CACHE_TTL_MS = 15_000;

@Injectable()
export class SettingsService {
  private cache: { value: MonitoringSettings; loadedAt: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** İzleme ayarlarını döndürür; eksik alanlar varsayılanlarla tamamlanır. Kısa süreli önbelleklenir. */
  async getMonitoring(): Promise<MonitoringSettings> {
    if (this.cache && Date.now() - this.cache.loadedAt < CACHE_TTL_MS) return this.cache.value;
    const row = await this.prisma.systemSetting.findUnique({ where: { key: MONITORING_SETTINGS_KEY } });
    const stored = (row?.value ?? {}) as Partial<MonitoringSettings>;
    const value: MonitoringSettings = {
      thresholds: { ...DEFAULT_MONITORING_SETTINGS.thresholds, ...(stored.thresholds ?? {}) },
      retention: { ...DEFAULT_MONITORING_SETTINGS.retention, ...(stored.retention ?? {}) },
    };
    this.cache = { value, loadedAt: Date.now() };
    return value;
  }

  async updateMonitoring(actor: AuthenticatedUser, settings: MonitoringSettings, ipAddress: string | null): Promise<MonitoringSettings> {
    const value: MonitoringSettings = {
      thresholds: { ...settings.thresholds },
      retention: { ...settings.retention },
    };
    await this.prisma.systemSetting.upsert({
      where: { key: MONITORING_SETTINGS_KEY },
      create: { key: MONITORING_SETTINGS_KEY, value: value as unknown as Prisma.InputJsonValue },
      update: { value: value as unknown as Prisma.InputJsonValue },
    });
    this.cache = null;
    await this.audit.record({
      userId: actor.id,
      actorLabel: actor.email,
      action: 'settings.monitoring.update',
      resourceType: 'system_setting',
      resourceId: MONITORING_SETTINGS_KEY,
      ipAddress,
      result: AuditResult.SUCCESS,
      metadata: value as unknown as Record<string, unknown>,
    });
    return value;
  }

  invalidate(): void {
    this.cache = null;
  }
}
