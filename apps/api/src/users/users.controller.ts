import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser, RequirePermissions, clientIp } from '../auth/decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PERMISSIONS, PERMISSION_DESCRIPTIONS, ROLE_LABELS } from '../permissions/permission-catalog';
import { CreateUserDto, ListUsersQueryDto, UpdateUserDto } from './dto/users.dto';
import { UsersService } from './users.service';

@ApiTags('Kullanıcılar')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.USERS_READ)
  @ApiOperation({ summary: 'Kullanıcıları listele' })
  list(@Query() query: ListUsersQueryDto) {
    return this.users.list(query);
  }

  @Get('meta/roles')
  @RequirePermissions(PERMISSIONS.USERS_READ)
  @ApiOperation({ summary: 'Rol ve izin kataloğu' })
  catalog() {
    return {
      roles: Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label })),
      permissions: Object.entries(PERMISSION_DESCRIPTIONS).map(([key, description]) => ({ key, description })),
    };
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.USERS_READ)
  @ApiOperation({ summary: 'Kullanıcı ayrıntısı' })
  get(@Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string) {
    return this.users.getById(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  @ApiOperation({ summary: 'Kullanıcı oluştur' })
  create(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateUserDto, @Req() request: Request) {
    return this.users.create(actor, dto, clientIp(request));
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  @ApiOperation({ summary: 'Kullanıcıyı güncelle (rol, durum, izinler, parola sıfırlama)' })
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
    @Body() dto: UpdateUserDto,
    @Req() request: Request,
  ) {
    return this.users.update(actor, id, dto, clientIp(request));
  }
}
