export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'OPERATOR' | 'VIEWER';

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  permissions: string[];
}

export interface UserProfile extends SessionUser {
  roleLabel: string;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AuthStatus {
  setupRequired: boolean;
  selfRegistrationEnabled: boolean;
}

export interface UserSessionInfo {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

export interface UserSummary {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  roleLabel: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  permissions: string[];
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface RoleCatalog {
  roles: { value: UserRole; label: string }[];
  permissions: { key: string; description: string }[];
}

export const ROLE_LABELS: Record<UserRole, string> = {
  SUPER_ADMIN: 'Süper Yönetici',
  ADMIN: 'Yönetici',
  OPERATOR: 'Operatör',
  VIEWER: 'İzleyici',
};
