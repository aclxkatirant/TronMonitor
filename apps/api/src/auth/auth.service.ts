import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AuditResult, UserRole, type User } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfigService } from '../config/config.service';
import { AuditService } from '../audit/audit.service';
import { PermissionsService } from '../permissions/permissions.service';
import { AppError } from '../common/app-error';
import { hashPassword, verifyPassword } from '../common/crypto';
import { ROLE_LABELS } from '../permissions/permission-catalog';
import { SessionService } from './session.service';
import type { AuthenticatedUser } from './auth.types';
import type { ChangePasswordDto, LoginDto, RegisterDto } from './dto/auth.dto';

export const SETTING_ALLOW_SELF_REGISTRATION = 'auth.allowSelfRegistration';

export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

export interface LoginResult {
  token: string;
  sessionId: string;
  user: AuthenticatedUser;
}

export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  roleLabel: string;
  permissions: string[];
  lastLoginAt: Date | null;
  createdAt: Date;
}

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  // Var olmayan kullanıcılar için de parola doğrulaması yapılır; böylece yanıt süresi e-posta varlığını ele vermez.
  private dummyHash: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly permissions: PermissionsService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.dummyHash = await hashPassword('tronmonitor-dummy-password-0');
    await this.bootstrapAdmin();
  }

  /** Ortam değişkenleriyle tanımlanmış ilk süper yöneticiyi yalnızca hiç kullanıcı yokken oluşturur. */
  private async bootstrapAdmin(): Promise<void> {
    const email = this.config.get('BOOTSTRAP_ADMIN_EMAIL');
    const password = this.config.get('BOOTSTRAP_ADMIN_PASSWORD');
    if (!email || !password) return;
    const count = await this.prisma.user.count();
    if (count > 0) return;
    if (password.length < 12) {
      this.logger.warn('BOOTSTRAP_ADMIN_PASSWORD en az 12 karakter olmalıdır; ilk yönetici oluşturulmadı.');
      return;
    }
    await this.prisma.user.create({
      data: {
        email: email.toLowerCase(),
        fullName: 'Süper Yönetici',
        passwordHash: await hashPassword(password),
        role: UserRole.SUPER_ADMIN,
      },
    });
    await this.audit.record({
      actorLabel: 'sistem',
      action: 'user.bootstrap',
      resourceType: 'user',
      result: AuditResult.SUCCESS,
      metadata: { email: email.toLowerCase() },
    });
    this.logger.log(`İlk süper yönetici oluşturuldu: ${email.toLowerCase()}`);
  }

  async getRegistrationStatus(): Promise<{ setupRequired: boolean; selfRegistrationEnabled: boolean }> {
    const userCount = await this.prisma.user.count();
    const setting = await this.prisma.systemSetting.findUnique({ where: { key: SETTING_ALLOW_SELF_REGISTRATION } });
    return {
      setupRequired: userCount === 0,
      selfRegistrationEnabled: setting?.value === true,
    };
  }

  async register(dto: RegisterDto, meta: RequestMeta): Promise<LoginResult> {
    const status = await this.getRegistrationStatus();
    if (!status.setupRequired && !status.selfRegistrationEnabled) {
      await this.audit.record({
        actorLabel: dto.email,
        action: 'user.register',
        resourceType: 'user',
        ipAddress: meta.ipAddress,
        result: AuditResult.DENIED,
        metadata: { reason: 'registration_closed' },
      });
      throw AppError.forbidden('AUTH_REGISTRATION_CLOSED');
    }

    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw AppError.conflict('AUTH_EMAIL_IN_USE');

    const role = status.setupRequired ? UserRole.SUPER_ADMIN : UserRole.VIEWER;
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        fullName: dto.fullName,
        passwordHash: await hashPassword(dto.password),
        role,
        lastLoginAt: new Date(),
      },
    });

    await this.audit.record({
      userId: user.id,
      actorLabel: user.email,
      action: status.setupRequired ? 'user.setup' : 'user.register',
      resourceType: 'user',
      resourceId: user.id,
      ipAddress: meta.ipAddress,
      result: AuditResult.SUCCESS,
      metadata: { role },
    });

    return this.startSession(user, meta);
  }

  async login(dto: LoginDto, meta: RequestMeta): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    const hashToCheck = user?.passwordHash ?? this.dummyHash ?? (await hashPassword('x'));
    const valid = await verifyPassword(dto.password, hashToCheck);

    if (!user || !valid) {
      await this.audit.record({
        userId: user?.id ?? null,
        actorLabel: dto.email,
        action: 'user.login',
        resourceType: 'user',
        resourceId: user?.id,
        ipAddress: meta.ipAddress,
        result: AuditResult.FAILURE,
        metadata: { reason: user ? 'wrong_password' : 'unknown_email' },
      });
      throw AppError.unauthorized('AUTH_INVALID_CREDENTIALS');
    }

    if (!user.isActive) {
      await this.audit.record({
        userId: user.id,
        actorLabel: user.email,
        action: 'user.login',
        resourceType: 'user',
        resourceId: user.id,
        ipAddress: meta.ipAddress,
        result: AuditResult.DENIED,
        metadata: { reason: 'account_disabled' },
      });
      throw AppError.forbidden('AUTH_ACCOUNT_DISABLED');
    }

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.record({
      userId: user.id,
      actorLabel: user.email,
      action: 'user.login',
      resourceType: 'user',
      resourceId: user.id,
      ipAddress: meta.ipAddress,
      result: AuditResult.SUCCESS,
    });

    return this.startSession(user, meta);
  }

  private async startSession(user: User, meta: RequestMeta): Promise<LoginResult> {
    const { token, session } = await this.sessions.create(user.id, meta.ipAddress, meta.userAgent);
    const permissions = await this.permissions.getEffectivePermissions(user.id, user.role);
    return {
      token,
      sessionId: session.id,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        permissions,
        authMethod: 'session',
        sessionId: session.id,
      },
    };
  }

  async logout(user: AuthenticatedUser, meta: RequestMeta): Promise<void> {
    if (user.sessionId) await this.sessions.revoke(user.sessionId);
    await this.audit.record({
      userId: user.id,
      actorLabel: user.email,
      action: 'user.logout',
      resourceType: 'user',
      resourceId: user.id,
      ipAddress: meta.ipAddress,
      result: AuditResult.SUCCESS,
    });
  }

  async getProfile(user: AuthenticatedUser): Promise<UserProfile> {
    const record = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (!record) throw AppError.unauthorized('AUTH_SESSION_EXPIRED');
    return {
      id: record.id,
      email: record.email,
      fullName: record.fullName,
      role: record.role,
      roleLabel: ROLE_LABELS[record.role],
      permissions: user.permissions,
      lastLoginAt: record.lastLoginAt,
      createdAt: record.createdAt,
    };
  }

  async changePassword(user: AuthenticatedUser, dto: ChangePasswordDto, meta: RequestMeta): Promise<{ revokedSessions: number }> {
    const record = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (!record) throw AppError.unauthorized('AUTH_SESSION_EXPIRED');

    const valid = await verifyPassword(dto.currentPassword, record.passwordHash);
    if (!valid) {
      await this.audit.record({
        userId: user.id,
        actorLabel: user.email,
        action: 'user.change_password',
        resourceType: 'user',
        resourceId: user.id,
        ipAddress: meta.ipAddress,
        result: AuditResult.FAILURE,
      });
      throw AppError.badRequest('AUTH_CURRENT_PASSWORD_WRONG');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(dto.newPassword) },
    });
    const revokedSessions = await this.sessions.revokeAllForUser(user.id, user.sessionId);
    await this.audit.record({
      userId: user.id,
      actorLabel: user.email,
      action: 'user.change_password',
      resourceType: 'user',
      resourceId: user.id,
      ipAddress: meta.ipAddress,
      result: AuditResult.SUCCESS,
      metadata: { revokedSessions },
    });
    return { revokedSessions };
  }

  async listSessions(user: AuthenticatedUser) {
    const sessions = await this.sessions.listActive(user.id);
    return sessions.map((session) => ({
      id: session.id,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
      expiresAt: session.expiresAt,
      isCurrent: session.id === user.sessionId,
    }));
  }

  async revokeSession(user: AuthenticatedUser, sessionId: string, meta: RequestMeta): Promise<void> {
    const session = await this.sessions.findOwned(user.id, sessionId);
    if (!session) throw AppError.notFound('AUTH_SESSION_NOT_FOUND');
    await this.sessions.revoke(session.id);
    await this.audit.record({
      userId: user.id,
      actorLabel: user.email,
      action: 'user.session_revoke',
      resourceType: 'session',
      resourceId: session.id,
      ipAddress: meta.ipAddress,
      result: AuditResult.SUCCESS,
    });
  }
}
