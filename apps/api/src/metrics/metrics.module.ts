import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RegistrationModule } from '../registration/registration.module';
import { MetricsMaintenanceScheduler } from './metrics-maintenance.scheduler';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

@Module({
  imports: [AuthModule, RegistrationModule],
  controllers: [MetricsController],
  providers: [MetricsService, MetricsMaintenanceScheduler],
  exports: [MetricsService],
})
export class MetricsModule {}
