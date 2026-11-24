import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError } from '../common/app-error';
import { PermissionsService } from '../permissions/permissions.service';
import type { PermissionKey } from '../permissions/permission-catalog';
import { IS_PUBLIC_KEY, REQUIRED_PERMISSIONS_KEY } from './decorators';
import { SessionService } from './session.service';
import {
  CSRF_HEADER_NAME,
  CSRF_HEADER_VALUE,
  SESSION_COOKIE_NAME,
  type AuthenticatedRequest,
} from './auth.types';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Oturum çerezi üzerinden kimlik doğrulaması yapar. Çerezle doğrulanan değiştirici isteklerde
 * CSRF koruması için özel başlık zorunludur (tarayıcılar çapraz kökenli formlarda bu başlığı gönderemez).
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly permissions: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const cookies = (request.cookies ?? {}) as Record<string, string | undefined>;
    const token = cookies[SESSION_COOKIE_NAME];

    if (token) {
      const validated = await this.sessions.validate(token);
      if (validated) {
        if (!SAFE_METHODS.has(request.method)) {
          const header = request.header(CSRF_HEADER_NAME);
          if (header !== CSRF_HEADER_VALUE) {
            throw AppError.forbidden('AUTH_CSRF');
          }
        }
        request.user = {
          id: validated.user.id,
          email: validated.user.email,
          fullName: validated.user.fullName,
          role: validated.user.role,
          permissions: await this.permissions.getEffectivePermissions(validated.user.id, validated.user.role),
          authMethod: 'session',
          sessionId: validated.session.id,
        };
        return true;
      }
      if (!isPublic) throw AppError.unauthorized('AUTH_SESSION_EXPIRED');
    }

    if (isPublic) return true;
    throw AppError.unauthorized('AUTH_UNAUTHENTICATED');
  }
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PermissionKey[] | undefined>(REQUIRED_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) throw AppError.unauthorized();
    if (!PermissionsService.hasAll(request.user.permissions, required)) {
      throw AppError.forbidden();
    }
    return true;
  }
}
