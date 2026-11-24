import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { PermissionKey } from '../permissions/permission-catalog';
import type { AuthenticatedRequest, AuthenticatedUser } from './auth.types';

export const IS_PUBLIC_KEY = 'tronmonitor:isPublic';
export const REQUIRED_PERMISSIONS_KEY = 'tronmonitor:permissions';

/** Uç noktayı kimlik doğrulaması olmadan erişilebilir yapar. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

/** Uç nokta için gereken izinleri belirtir (tamamı gereklidir). */
export const RequirePermissions = (...permissions: PermissionKey[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);

/** Doğrulanmış kullanıcıyı işleyiciye enjekte eder. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
  const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!request.user) {
    throw new Error('CurrentUser yalnızca kimliği doğrulanmış uç noktalarda kullanılabilir');
  }
  return request.user;
});

export function clientIp(request: { ip?: string; socket?: { remoteAddress?: string } }): string | null {
  return request.ip ?? request.socket?.remoteAddress ?? null;
}
