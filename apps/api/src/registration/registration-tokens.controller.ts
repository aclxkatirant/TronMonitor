import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser, RequirePermissions, clientIp } from '../auth/decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PERMISSIONS } from '../permissions/permission-catalog';
import { CreateRegistrationTokenDto, SUPPORTED_ARCHITECTURES, SUPPORTED_OS_VERSIONS } from './dto/registration-token.dto';
import { RegistrationTokensService } from './registration-tokens.service';

@ApiTags('Sunucu kaydı')
@Controller('registration-tokens')
export class RegistrationTokensController {
  constructor(private readonly tokens: RegistrationTokensService) {}

  @Get('meta/platforms')
  @RequirePermissions(PERMISSIONS.SERVERS_READ)
  @ApiOperation({ summary: 'Desteklenen işletim sistemi sürümleri ve mimariler' })
  platforms() {
    return { osVersions: SUPPORTED_OS_VERSIONS, architectures: SUPPORTED_ARCHITECTURES };
  }

  @Get()
  @RequirePermissions(PERMISSIONS.SERVERS_REGISTER)
  @ApiOperation({ summary: 'Kayıt belirteçlerini listele (düz metin asla döndürülmez)' })
  list() {
    return this.tokens.list();
  }

  @Post()
  @RequirePermissions(PERMISSIONS.SERVERS_REGISTER)
  @ApiOperation({ summary: 'Kısa ömürlü, tek kullanımlık kayıt belirteci oluştur; düz metin yalnızca bu yanıtta döner' })
  create(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateRegistrationTokenDto, @Req() request: Request) {
    return this.tokens.create(actor, dto, clientIp(request));
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.SERVERS_REGISTER)
  @ApiOperation({ summary: 'Kayıt belirtecini iptal et' })
  async revoke(@CurrentUser() actor: AuthenticatedUser, @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string, @Req() request: Request) {
    await this.tokens.revoke(actor, id, clientIp(request));
  }
}
