import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser, RequirePermissions, clientIp } from '../auth/decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PERMISSIONS } from '../permissions/permission-catalog';
import { IncidentActionDto, ListIncidentsQueryDto } from './dto/incidents.dto';
import { INCIDENT_SEVERITY_LABELS, INCIDENT_TYPE_LABELS, IncidentsService } from './incidents.service';

const uuid = () => new ParseUUIDPipe({ errorHttpStatusCode: 404 });

@ApiTags('Olaylar')
@Controller('incidents')
export class IncidentsController {
  constructor(private readonly incidents: IncidentsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.INCIDENTS_READ)
  @ApiOperation({ summary: 'Olayları listele' })
  list(@Query() query: ListIncidentsQueryDto) {
    return this.incidents.list(query);
  }

  @Get('meta/catalog')
  @RequirePermissions(PERMISSIONS.INCIDENTS_READ)
  @ApiOperation({ summary: 'Olay türü ve önem etiketleri' })
  catalog() {
    return {
      types: Object.entries(INCIDENT_TYPE_LABELS).map(([value, label]) => ({ value, label })),
      severities: Object.entries(INCIDENT_SEVERITY_LABELS).map(([value, label]) => ({ value, label })),
    };
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.INCIDENTS_READ)
  @ApiOperation({ summary: 'Olay ayrıntısı, zaman çizelgesi ve bildirimleri' })
  get(@Param('id', uuid()) id: string) {
    return this.incidents.getById(id);
  }

  @Post(':id/acknowledge')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.INCIDENTS_MANAGE)
  @ApiOperation({ summary: 'Olayı üstlen' })
  acknowledge(@CurrentUser() actor: AuthenticatedUser, @Param('id', uuid()) id: string, @Body() dto: IncidentActionDto, @Req() request: Request) {
    return this.incidents.acknowledge(actor, id, dto, clientIp(request));
  }

  @Post(':id/resolve')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.INCIDENTS_MANAGE)
  @ApiOperation({ summary: 'Olayı elle çöz' })
  resolve(@CurrentUser() actor: AuthenticatedUser, @Param('id', uuid()) id: string, @Body() dto: IncidentActionDto, @Req() request: Request) {
    return this.incidents.resolveManual(actor, id, dto, clientIp(request));
  }

  @Post(':id/notes')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.INCIDENTS_MANAGE)
  @ApiOperation({ summary: 'Olaya not ekle' })
  note(@CurrentUser() actor: AuthenticatedUser, @Param('id', uuid()) id: string, @Body() dto: IncidentActionDto, @Req() request: Request) {
    return this.incidents.addNote(actor, id, dto, clientIp(request));
  }
}
