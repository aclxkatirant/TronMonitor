import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser, RequirePermissions, clientIp } from '../auth/decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PERMISSIONS } from '../permissions/permission-catalog';
import { GroupDto, ListEventsQueryDto, ListServersQueryDto, TagDto, UpdateAgentSettingsDto, UpdateGroupDto, UpdateServerDto } from './dto/servers.dto';
import { GroupsTagsService } from './groups-tags.service';
import { ServersService } from './servers.service';

const uuid = () => new ParseUUIDPipe({ errorHttpStatusCode: 404 });

@ApiTags('Sunucular')
@Controller('servers')
export class ServersController {
  constructor(private readonly servers: ServersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SERVERS_READ)
  @ApiOperation({ summary: 'Sunucuları listele (filtre, sıralama, sayfalama, son metrikler)' })
  list(@Query() query: ListServersQueryDto) {
    return this.servers.list(query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.SERVERS_READ)
  @ApiOperation({ summary: 'Sunucu ayrıntısı' })
  get(@Param('id', uuid()) id: string) {
    return this.servers.getById(id);
  }

  @Get(':id/events')
  @RequirePermissions(PERMISSIONS.SERVERS_READ)
  @ApiOperation({ summary: 'Ajan bağlantı geçmişi' })
  events(@Param('id', uuid()) id: string, @Query() query: ListEventsQueryDto) {
    return this.servers.listEvents(id, query);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.SERVERS_MANAGE)
  @ApiOperation({ summary: 'Sunucu adı, açıklaması, grubu ve etiketlerini güncelle' })
  update(@CurrentUser() actor: AuthenticatedUser, @Param('id', uuid()) id: string, @Body() dto: UpdateServerDto, @Req() request: Request) {
    return this.servers.update(actor, id, dto, clientIp(request));
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.SERVERS_DELETE)
  @ApiOperation({ summary: 'Sunucuyu ve tüm verilerini sil' })
  async remove(@CurrentUser() actor: AuthenticatedUser, @Param('id', uuid()) id: string, @Req() request: Request) {
    await this.servers.remove(actor, id, clientIp(request));
  }

  @Post(':id/agent/revoke')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.AGENTS_MANAGE)
  @ApiOperation({ summary: 'Ajan kimlik bilgisini iptal et; ajan veri gönderemez' })
  revoke(@CurrentUser() actor: AuthenticatedUser, @Param('id', uuid()) id: string, @Req() request: Request) {
    return this.servers.revokeAgent(actor, id, clientIp(request));
  }

  @Patch(':id/agent')
  @RequirePermissions(PERMISSIONS.AGENTS_MANAGE)
  @ApiOperation({ summary: 'Ajan ayarlarını güncelle (toplama aralığı)' })
  agentSettings(@CurrentUser() actor: AuthenticatedUser, @Param('id', uuid()) id: string, @Body() dto: UpdateAgentSettingsDto, @Req() request: Request) {
    return this.servers.updateAgentSettings(actor, id, dto, clientIp(request));
  }
}

@ApiTags('Sunucu grupları')
@Controller('server-groups')
export class ServerGroupsController {
  constructor(private readonly service: GroupsTagsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SERVERS_READ)
  list() {
    return this.service.listGroups();
  }

  @Post()
  @RequirePermissions(PERMISSIONS.SERVERS_MANAGE)
  create(@CurrentUser() actor: AuthenticatedUser, @Body() dto: GroupDto, @Req() request: Request) {
    return this.service.createGroup(actor, dto, clientIp(request));
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.SERVERS_MANAGE)
  update(@CurrentUser() actor: AuthenticatedUser, @Param('id', uuid()) id: string, @Body() dto: UpdateGroupDto, @Req() request: Request) {
    return this.service.updateGroup(actor, id, dto, clientIp(request));
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.SERVERS_MANAGE)
  async remove(@CurrentUser() actor: AuthenticatedUser, @Param('id', uuid()) id: string, @Req() request: Request) {
    await this.service.deleteGroup(actor, id, clientIp(request));
  }
}

@ApiTags('Etiketler')
@Controller('tags')
export class TagsController {
  constructor(private readonly service: GroupsTagsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SERVERS_READ)
  list() {
    return this.service.listTags();
  }

  @Post()
  @RequirePermissions(PERMISSIONS.SERVERS_MANAGE)
  create(@CurrentUser() actor: AuthenticatedUser, @Body() dto: TagDto, @Req() request: Request) {
    return this.service.createTag(actor, dto, clientIp(request));
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.SERVERS_MANAGE)
  async remove(@CurrentUser() actor: AuthenticatedUser, @Param('id', uuid()) id: string, @Req() request: Request) {
    await this.service.deleteTag(actor, id, clientIp(request));
  }
}
