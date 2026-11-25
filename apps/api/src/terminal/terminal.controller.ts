import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser, RequirePermissions, clientIp } from '../auth/decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PERMISSIONS } from '../permissions/permission-catalog';
import { CredentialsService } from './credentials.service';
import { ListSessionsQueryDto, UpsertCredentialDto } from './dto/terminal.dto';
import { TERMINAL_PROTOCOL_LABELS, TERMINAL_STATUS_LABELS, TerminalService } from './terminal.service';

const uuid = () => new ParseUUIDPipe({ errorHttpStatusCode: 404 });

@ApiTags('Terminal')
@Controller()
export class TerminalController {
  constructor(
    private readonly terminal: TerminalService,
    private readonly credentials: CredentialsService,
  ) {}

  @Get('terminal/meta/catalog')
  @RequirePermissions(PERMISSIONS.TERMINAL_USE)
  catalog() {
    return {
      statuses: Object.entries(TERMINAL_STATUS_LABELS).map(([value, label]) => ({ value, label })),
      protocols: Object.entries(TERMINAL_PROTOCOL_LABELS).map(([value, label]) => ({ value, label })),
    };
  }

  @Get('terminal/servers')
  @RequirePermissions(PERMISSIONS.TERMINAL_USE)
  @ApiOperation({ summary: 'Terminal açılabilecek sunucular ve yöntemleri' })
  servers() {
    return this.terminal.listServers();
  }

  @Get('terminal/sessions')
  @RequirePermissions(PERMISSIONS.TERMINAL_USE)
  @ApiOperation({ summary: 'Terminal oturum geçmişi (audit.read ile tüm kullanıcılar)' })
  sessions(@CurrentUser() user: AuthenticatedUser, @Query() query: ListSessionsQueryDto) {
    return this.terminal.listSessions(user, query);
  }

  @Get('terminal/sessions/:id/commands')
  @RequirePermissions(PERMISSIONS.TERMINAL_USE)
  @ApiOperation({ summary: 'Oturumda yazılan komut satırları' })
  commands(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid()) id: string) {
    return this.terminal.listCommands(user, id);
  }

  @Post('terminal/sessions/:id/terminate')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.TERMINAL_USE)
  @ApiOperation({ summary: 'Etkin oturumu sonlandır (sahibi veya terminal.credentials)' })
  async terminate(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid()) id: string, @Req() request: Request) {
    await this.terminal.terminate(user, id, clientIp(request));
  }

  @Get('servers/:id/credential')
  @RequirePermissions(PERMISSIONS.TERMINAL_CREDENTIALS)
  @ApiOperation({ summary: 'Sunucunun SSH kimlik bilgisi (sır hariç)' })
  getCredential(@Param('id', uuid()) id: string) {
    return this.credentials.get(id);
  }

  @Put('servers/:id/credential')
  @RequirePermissions(PERMISSIONS.TERMINAL_CREDENTIALS)
  @ApiOperation({ summary: 'SSH kimlik bilgisini oluştur veya güncelle' })
  putCredential(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid()) id: string, @Body() dto: UpsertCredentialDto, @Req() request: Request) {
    return this.credentials.upsert(user, id, dto, clientIp(request));
  }

  @Delete('servers/:id/credential')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.TERMINAL_CREDENTIALS)
  async deleteCredential(@CurrentUser() user: AuthenticatedUser, @Param('id', uuid()) id: string, @Req() request: Request) {
    await this.credentials.remove(user, id, clientIp(request));
  }
}
