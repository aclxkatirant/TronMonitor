import { Injectable } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import type { UserRole } from '../generated/prisma/client';
import { AppConfigService } from '../config/config.service';
import { SessionService } from '../auth/session.service';
import { PermissionsService } from '../permissions/permissions.service';
import { SESSION_COOKIE_NAME } from '../auth/auth.types';

export interface WsUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  permissions: string[];
}

/**
 * Tarayıcı WebSocket bağlantıları için ortak kimlik doğrulama: oturum çerezi + Origin denetimi.
 * API belirteçleri WebSocket'te kabul edilmez (yalnızca oturum çerezi).
 */
@Injectable()
export class WsAuthService {
  constructor(
    private readonly sessions: SessionService,
    private readonly permissions: PermissionsService,
    private readonly config: AppConfigService,
  ) {}

  /** Origin başlığı yoksa (tarayıcı dışı istemci) reddedilmez; varsa WEB_ORIGIN ile eşleşmelidir. */
  isAllowedOrigin(origin: string | undefined): boolean {
    if (!origin) return true;
    const allowed = this.config.get('WEB_ORIGIN');
    if (origin === allowed) return true;
    // Geliştirmede localhost ve 127.0.0.1 birbirinin yerine kullanılabilir.
    if (!this.config.isProduction) {
      try {
        const a = new URL(origin);
        const b = new URL(allowed);
        const loopback = (h: string) => h === 'localhost' || h === '127.0.0.1';
        return loopback(a.hostname) && loopback(b.hostname) && a.port === b.port;
      } catch {
        return false;
      }
    }
    return false;
  }

  async authenticate(request: IncomingMessage): Promise<WsUser | null> {
    const token = parseCookie(request.headers.cookie ?? '', SESSION_COOKIE_NAME);
    const validated = token ? await this.sessions.validate(token) : null;
    if (!validated) return null;
    const permissions = await this.permissions.getEffectivePermissions(validated.user.id, validated.user.role);
    return { id: validated.user.id, email: validated.user.email, fullName: validated.user.fullName, role: validated.user.role, permissions };
  }
}

export function parseCookie(header: string, name: string): string | null {
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function remoteIp(request: IncomingMessage): string | null {
  const forwarded = request.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
  return first?.trim() || request.socket.remoteAddress || null;
}
