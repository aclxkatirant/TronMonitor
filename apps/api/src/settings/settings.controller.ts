import { Body, Controller, Get, Put, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser, RequirePermissions, clientIp } from '../auth/decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PERMISSIONS } from '../permissions/permission-catalog';
import { DEFAULT_MONITORING_SETTINGS, MonitoringSettingsDto } from './monitoring-settings';
import { SettingsService } from './settings.service';

@ApiTags('Ayarlar')
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('monitoring')
  @RequirePermissions(PERMISSIONS.SETTINGS_READ)
  @ApiOperation({ summary: 'İzleme eşikleri ve veri saklama süreleri' })
  async getMonitoring() {
    return { ...(await this.settings.getMonitoring()), defaults: DEFAULT_MONITORING_SETTINGS };
  }

  @Put('monitoring')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  @ApiOperation({ summary: 'İzleme eşiklerini ve saklama sürelerini güncelle' })
  async updateMonitoring(@CurrentUser() actor: AuthenticatedUser, @Body() dto: MonitoringSettingsDto, @Req() request: Request) {
    return { ...(await this.settings.updateMonitoring(actor, dto, clientIp(request))), defaults: DEFAULT_MONITORING_SETTINGS };
  }
}
