import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CurrentUser, RequirePermissions, clientIp } from '../auth/decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PERMISSIONS } from '../permissions/permission-catalog';
import { CreateChannelDto, UpdateChannelDto } from './dto/notifications.dto';
import { NotificationsService } from './notifications.service';

const uuid = () => new ParseUUIDPipe({ errorHttpStatusCode: 404 });

@ApiTags('Bildirimler')
@Controller('notification-channels')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('meta/catalog')
  @RequirePermissions(PERMISSIONS.NOTIFICATIONS_READ)
  catalog() {
    return this.notifications.catalog();
  }

  @Get()
  @RequirePermissions(PERMISSIONS.NOTIFICATIONS_READ)
  @ApiOperation({ summary: 'Bildirim kanallarını listele (sırlar maskelenir)' })
  list() {
    return this.notifications.listChannels();
  }

  @Get('recent')
  @RequirePermissions(PERMISSIONS.NOTIFICATIONS_READ)
  @ApiOperation({ summary: 'Son gönderilen bildirimler' })
  recent() {
    return this.notifications.recentNotifications();
  }

  @Post()
  @RequirePermissions(PERMISSIONS.NOTIFICATIONS_MANAGE)
  create(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateChannelDto, @Req() request: Request) {
    return this.notifications.createChannel(actor, dto, clientIp(request));
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.NOTIFICATIONS_MANAGE)
  update(@CurrentUser() actor: AuthenticatedUser, @Param('id', uuid()) id: string, @Body() dto: UpdateChannelDto, @Req() request: Request) {
    return this.notifications.updateChannel(actor, id, dto, clientIp(request));
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.NOTIFICATIONS_MANAGE)
  async remove(@CurrentUser() actor: AuthenticatedUser, @Param('id', uuid()) id: string, @Req() request: Request) {
    await this.notifications.deleteChannel(actor, id, clientIp(request));
  }

  @Post(':id/test')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.NOTIFICATIONS_MANAGE)
  @ApiOperation({ summary: 'Kanala test bildirimi gönder' })
  test(@CurrentUser() actor: AuthenticatedUser, @Param('id', uuid()) id: string, @Req() request: Request) {
    return this.notifications.testChannel(actor, id, clientIp(request));
  }
}
