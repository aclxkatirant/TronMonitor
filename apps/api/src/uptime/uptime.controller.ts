import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser, RequirePermissions, clientIp } from '../auth/decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PERMISSIONS } from '../permissions/permission-catalog';
import { MetricsQueryDto } from '../metrics/dto/metrics.dto';
import { CreateCheckDto, ListChecksQueryDto, ResultsQueryDto, UpdateCheckDto } from './dto/uptime.dto';
import { CHECK_TYPE_LABELS, UptimeService } from './uptime.service';

const uuid = () => new ParseUUIDPipe({ errorHttpStatusCode: 404 });

@ApiTags('Erişilebilirlik')
@Controller('checks')
export class UptimeController {
  constructor(private readonly uptime: UptimeService) {}

  @Get('meta/catalog')
  @RequirePermissions(PERMISSIONS.UPTIME_READ)
  catalog() {
    return { types: Object.entries(CHECK_TYPE_LABELS).map(([value, label]) => ({ value, label })) };
  }

  @Get('summary')
  @RequirePermissions(PERMISSIONS.UPTIME_READ)
  @ApiOperation({ summary: 'Son 24 saatteki genel erişilebilirlik' })
  summary() {
    return this.uptime.overallUptime24h();
  }

  @Get()
  @RequirePermissions(PERMISSIONS.UPTIME_READ)
  @ApiOperation({ summary: 'Kontrolleri listele (24 saatlik erişilebilirlik ile)' })
  list(@Query() query: ListChecksQueryDto) {
    return this.uptime.list(query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.UPTIME_READ)
  get(@Param('id', uuid()) id: string) {
    return this.uptime.getById(id);
  }

  @Get(':id/results')
  @RequirePermissions(PERMISSIONS.UPTIME_READ)
  @ApiOperation({ summary: 'Son kontrol sonuçları' })
  results(@Param('id', uuid()) id: string, @Query() query: ResultsQueryDto) {
    return this.uptime.results(id, query);
  }

  @Get(':id/history')
  @RequirePermissions(PERMISSIONS.UPTIME_READ)
  @ApiOperation({ summary: 'Yanıt süresi ve erişilebilirlik geçmişi' })
  history(@Param('id', uuid()) id: string, @Query() query: MetricsQueryDto) {
    return this.uptime.history(id, query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.UPTIME_MANAGE)
  create(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateCheckDto, @Req() request: Request) {
    return this.uptime.create(actor, dto, clientIp(request));
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.UPTIME_MANAGE)
  update(@CurrentUser() actor: AuthenticatedUser, @Param('id', uuid()) id: string, @Body() dto: UpdateCheckDto, @Req() request: Request) {
    return this.uptime.update(actor, id, dto, clientIp(request));
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.UPTIME_MANAGE)
  async remove(@CurrentUser() actor: AuthenticatedUser, @Param('id', uuid()) id: string, @Req() request: Request) {
    await this.uptime.remove(actor, id, clientIp(request));
  }

  @Post(':id/run')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.UPTIME_MANAGE)
  @ApiOperation({ summary: 'Kontrolü hemen çalıştır' })
  async run(@Param('id', uuid()) id: string) {
    const outcome = await this.uptime.execute(id);
    return outcome ?? { skipped: true };
  }
}
