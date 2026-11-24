import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/decorators';
import { PERMISSIONS } from '../permissions/permission-catalog';
import { DashboardService } from './dashboard.service';

@ApiTags('Genel bakış')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  @RequirePermissions(PERMISSIONS.DASHBOARD_READ)
  @ApiOperation({ summary: 'Altyapı özeti: sunucu sayıları, ortalama kullanım, son olaylar' })
  summary() {
    return this.dashboard.summary();
  }
}
