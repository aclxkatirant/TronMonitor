import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser, Public, RequirePermissions, clientIp } from '../auth/decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PERMISSIONS } from '../permissions/permission-catalog';
import { AgentAuthGuard, type AgentRequest } from '../agents/agent-auth.guard';
import { CommandResultDto, ListCommandsQueryDto, ListServicesQueryDto, ServiceControlDto, ServiceReportDto, UpdateMonitoredServiceDto } from './dto/services.dto';
import { SERVICE_STATE_LABELS, ServicesService } from './services.service';

const uuid = () => new ParseUUIDPipe({ errorHttpStatusCode: 404 });

@ApiTags('Ajan iletişimi')
@Controller('agents')
export class AgentServicesController {
  constructor(private readonly services: ServicesService) {}

  @Public()
  @UseGuards(AgentAuthGuard)
  @Post('services')
  @HttpCode(200)
  @ApiOperation({ summary: 'Hizmet listesi raporu (HMAC imzalı)' })
  report(@Body() dto: ServiceReportDto, @Req() request: AgentRequest) {
    return this.services.applyReport(request.agent!, dto);
  }

  @Public()
  @UseGuards(AgentAuthGuard)
  @Get('commands/wait')
  @ApiOperation({ summary: 'Komut uzun yoklaması: bekleyen komut yoksa en fazla 25 sn bekler (HMAC imzalı)' })
  wait(@Req() request: AgentRequest) {
    return this.services.waitForCommands(request.agent!.agentId, 25_000);
  }

  @Public()
  @UseGuards(AgentAuthGuard)
  @Post('commands/:id/result')
  @HttpCode(204)
  @ApiOperation({ summary: 'Komut sonucu bildirimi (HMAC imzalı)' })
  async result(@Param('id', uuid()) id: string, @Body() dto: CommandResultDto, @Req() request: AgentRequest) {
    await this.services.completeCommand(request.agent!, id, dto);
  }
}

@ApiTags('Hizmetler')
@Controller()
export class ServicesController {
  constructor(private readonly services: ServicesService) {}

  @Get('services/meta/catalog')
  @RequirePermissions(PERMISSIONS.SERVICES_READ)
  catalog() {
    return { states: Object.entries(SERVICE_STATE_LABELS).map(([value, label]) => ({ value, label })) };
  }

  @Get('services/monitored')
  @RequirePermissions(PERMISSIONS.SERVICES_READ)
  @ApiOperation({ summary: 'Tüm sunuculardaki izlenen hizmetler' })
  monitored() {
    return this.services.listMonitored();
  }

  @Get('services/commands')
  @RequirePermissions(PERMISSIONS.SERVICES_READ)
  @ApiOperation({ summary: 'Son hizmet komutları ve sonuçları' })
  commands(@Query() query: ListCommandsQueryDto) {
    return this.services.listCommands(query);
  }

  @Get('servers/:id/services')
  @RequirePermissions(PERMISSIONS.SERVICES_READ)
  @ApiOperation({ summary: 'Sunucudaki hizmetler' })
  list(@Param('id', uuid()) id: string, @Query() query: ListServicesQueryDto) {
    return this.services.listForServer(id, query);
  }

  @Get('servers/:id/services/:serviceId/events')
  @RequirePermissions(PERMISSIONS.SERVICES_READ)
  events(@Param('id', uuid()) id: string, @Param('serviceId', uuid()) serviceId: string) {
    return this.services.events(id, serviceId);
  }

  @Patch('servers/:id/services/:serviceId')
  @RequirePermissions(PERMISSIONS.SERVICES_MANAGE)
  @ApiOperation({ summary: 'Hizmeti izlemeye al / izlemeden çıkar' })
  setMonitored(@CurrentUser() actor: AuthenticatedUser, @Param('id', uuid()) id: string, @Param('serviceId', uuid()) serviceId: string, @Body() dto: UpdateMonitoredServiceDto, @Req() request: Request) {
    return this.services.setMonitored(actor, id, serviceId, dto.isMonitored, clientIp(request));
  }

  @Post('servers/:id/services/:serviceId/control')
  @RequirePermissions(PERMISSIONS.SERVICES_CONTROL)
  @ApiOperation({ summary: 'Hizmeti başlat / durdur / yeniden başlat (ajana komut kuyruklar)' })
  control(@CurrentUser() actor: AuthenticatedUser, @Param('id', uuid()) id: string, @Param('serviceId', uuid()) serviceId: string, @Body() dto: ServiceControlDto, @Req() request: Request) {
    return this.services.requestControl(actor, id, serviceId, dto.action, clientIp(request));
  }
}
