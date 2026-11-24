import { Module } from '@nestjs/common';
import { ServersModule } from '../servers/servers.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [ServersModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
