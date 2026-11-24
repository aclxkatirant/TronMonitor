import { Injectable, Module, OnModuleInit } from '@nestjs/common';
import { MaintenanceService } from '../queue/maintenance.service';
import { UptimeController } from './uptime.controller';
import { UptimeService } from './uptime.service';

export const JOB_UPTIME_RUN = 'uptime-run';
export const JOB_UPTIME_PURGE = 'uptime-purge';

@Injectable()
export class UptimeScheduler implements OnModuleInit {
  constructor(
    private readonly maintenance: MaintenanceService,
    private readonly uptime: UptimeService,
  ) {}

  onModuleInit(): void {
    // Süresi gelen kontroller her 10 saniyede bir taranır; kaçırılan çalıştırmalar bir sonraki taramada yakalanır.
    this.maintenance.register(JOB_UPTIME_RUN, 10_000, () => this.uptime.runDueChecks());
    this.maintenance.register(JOB_UPTIME_PURGE, 6 * 3_600_000, async () => ({ purged: await this.uptime.purgeResults(30) }));
  }
}

@Module({
  controllers: [UptimeController],
  providers: [UptimeService, UptimeScheduler],
  exports: [UptimeService],
})
export class UptimeModule {}
