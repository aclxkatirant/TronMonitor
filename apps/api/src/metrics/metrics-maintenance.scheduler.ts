import { Injectable, OnModuleInit } from '@nestjs/common';
import { MaintenanceService } from '../queue/maintenance.service';
import { SessionService } from '../auth/session.service';
import { RegistrationTokensService } from '../registration/registration-tokens.service';
import { MetricsService } from './metrics.service';

export const JOB_METRICS_AGGREGATE = 'metrics-aggregate';
export const JOB_RETENTION = 'retention';

@Injectable()
export class MetricsMaintenanceScheduler implements OnModuleInit {
  constructor(
    private readonly maintenance: MaintenanceService,
    private readonly metrics: MetricsService,
    private readonly sessions: SessionService,
    private readonly registrationTokens: RegistrationTokensService,
  ) {}

  onModuleInit(): void {
    this.maintenance.register(JOB_METRICS_AGGREGATE, 5 * 60_000, () => this.metrics.aggregate());
    this.maintenance.register(JOB_RETENTION, 60 * 60_000, async () => ({
      ...(await this.metrics.applyRetention()),
      sessions: await this.sessions.purgeExpired(),
      registrationTokens: await this.registrationTokens.purgeExpired(),
    }));
  }
}
