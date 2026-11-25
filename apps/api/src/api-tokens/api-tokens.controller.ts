import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CurrentUser, RequirePermissions, clientIp } from '../auth/decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PERMISSIONS, PERMISSION_DESCRIPTIONS } from '../permissions/permission-catalog';
import { CreateApiTokenDto } from './dto/api-tokens.dto';
import { ApiTokensService } from './api-tokens.service';

@ApiTags('API yönetimi')
@Controller('api-tokens')
export class ApiTokensController {
  constructor(private readonly tokens: ApiTokensService) {}

  @Get('meta/scopes')
  @RequirePermissions(PERMISSIONS.API_TOKENS_OWN)
  @ApiOperation({ summary: 'Belirtece verilebilecek izinler (kullanıcının kendi izinleri)' })
  scopes(@CurrentUser() actor: AuthenticatedUser) {
    return actor.permissions.map((key) => ({ key, description: PERMISSION_DESCRIPTIONS[key as keyof typeof PERMISSION_DESCRIPTIONS] ?? key }));
  }

  @Get()
  @RequirePermissions(PERMISSIONS.API_TOKENS_OWN)
  @ApiOperation({ summary: 'Belirteçleri listele (all=true ile yetkiliyse tüm kullanıcılar)' })
  list(@CurrentUser() actor: AuthenticatedUser, @Query('all') all?: string) {
    return this.tokens.list(actor, all === 'true');
  }

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @RequirePermissions(PERMISSIONS.API_TOKENS_OWN)
  @ApiOperation({ summary: 'Belirteç oluştur; düz metin yalnızca bu yanıtta döner' })
  create(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateApiTokenDto, @Req() request: Request) {
    return this.tokens.create(actor, dto, clientIp(request));
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.API_TOKENS_OWN)
  @ApiOperation({ summary: 'Belirteci iptal et' })
  async revoke(@CurrentUser() actor: AuthenticatedUser, @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string, @Req() request: Request) {
    await this.tokens.revoke(actor, id, clientIp(request));
  }
}
