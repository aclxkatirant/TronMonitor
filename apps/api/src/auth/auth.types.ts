import type { Request } from 'express';
import type { UserRole } from '../generated/prisma/client';

export type AuthMethod = 'session' | 'api_token';

export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  permissions: string[];
  authMethod: AuthMethod;
  sessionId?: string;
  apiTokenId?: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

export const SESSION_COOKIE_NAME = 'tm_session';
export const CSRF_HEADER_NAME = 'x-requested-with';
export const CSRF_HEADER_VALUE = 'XMLHttpRequest';
