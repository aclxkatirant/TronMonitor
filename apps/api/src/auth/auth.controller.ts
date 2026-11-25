import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AppConfigService } from '../config/config.service';
import { AppError } from '../common/app-error';
import { AuthService, type RequestMeta } from './auth.service';
import { CurrentUser, Public, clientIp } from './decorators';
import { SESSION_COOKIE_NAME, type AuthenticatedUser } from './auth.types';
import { ChangePasswordDto, LoginDto, RegisterDto } from './dto/auth.dto';

const LOGIN_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

/** Hesap yönetimi uçları kapsamlı API belirteçleriyle kullanılamaz; yalnızca tarayıcı oturumu. */
function assertBrowserSession(user: AuthenticatedUser): void {
  if (user.authMethod !== 'session') throw AppError.forbidden('AUTH_SESSION_REQUIRED');
}

@ApiTags('Kimlik doğrulama')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfigService,
  ) {}

  private meta(request: Request): RequestMeta {
    return { ipAddress: clientIp(request), userAgent: request.header('user-agent') ?? null };
  }

  private setSessionCookie(response: Response, token: string): void {
    response.cookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.get('COOKIE_SECURE'),
      path: '/',
      maxAge: this.config.sessionTtlMs,
    });
  }

  private clearSessionCookie(response: Response): void {
    response.clearCookie(SESSION_COOKIE_NAME, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.get('COOKIE_SECURE'),
      path: '/',
    });
  }

  @Public()
  @Get('status')
  @ApiOperation({ summary: 'Kayıt durumu: ilk kurulum gerekiyor mu, kendi kendine kayıt açık mı' })
  status() {
    return this.auth.getRegistrationStatus();
  }

  @Public()
  @Throttle(LOGIN_THROTTLE)
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'E-posta ve parola ile oturum aç' })
  async login(@Body() dto: LoginDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.login(dto, this.meta(request));
    this.setSessionCookie(response, result.token);
    return { user: result.user };
  }

  @Public()
  @Throttle(LOGIN_THROTTLE)
  @Post('register')
  @ApiOperation({ summary: 'Yeni hesap oluştur (ilk kurulumda süper yönetici, aksi halde ayar açıksa izleyici)' })
  async register(@Body() dto: RegisterDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.register(dto, this.meta(request));
    this.setSessionCookie(response, result.token);
    return { user: result.user };
  }

  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Geçerli oturumu kapat' })
  async logout(@CurrentUser() user: AuthenticatedUser, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    assertBrowserSession(user);
    await this.auth.logout(user, this.meta(request));
    this.clearSessionCookie(response);
  }

  @Get('me')
  @ApiOperation({ summary: 'Oturum açmış kullanıcının profili ve izinleri' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.getProfile(user);
  }

  @Post('change-password')
  @HttpCode(200)
  @Throttle(LOGIN_THROTTLE)
  @ApiOperation({ summary: 'Parola değiştir; diğer oturumlar kapatılır' })
  changePassword(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChangePasswordDto, @Req() request: Request) {
    assertBrowserSession(user);
    return this.auth.changePassword(user, dto, this.meta(request));
  }

  @Get('sessions')
  @ApiOperation({ summary: 'Etkin oturumları listele' })
  sessions(@CurrentUser() user: AuthenticatedUser) {
    assertBrowserSession(user);
    return this.auth.listSessions(user);
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Belirli bir oturumu sonlandır' })
  async revokeSession(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    assertBrowserSession(user);
    await this.auth.revokeSession(user, id, this.meta(request));
    if (id === user.sessionId) this.clearSessionCookie(response);
  }
}
