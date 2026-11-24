import { Module } from '@nestjs/common';
import { ServersModule } from '../servers/servers.module';
import { UptimeModule } from '../uptime/uptime.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [ServersModule, UptimeModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
