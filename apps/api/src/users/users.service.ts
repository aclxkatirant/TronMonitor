import { Injectable } from '@nestjs/common';
import { AuditResult, UserRole, type Prisma, type User } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/app-error';
import { hashPassword } from '../common/crypto';
import { ROLE_LABELS, ROLE_RANK } from '../permissions/permission-catalog';
import { SessionService } from '../auth/session.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { CreateUserDto, ListUsersQueryDto, UpdateUserDto } from './dto/users.dto';

export interface UserSummary {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  roleLabel: string;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  permissions: string[];
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
  ) {}

  private toSummary(user: User & { permissions?: { permissionKey: string }[] }): UserSummary {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      roleLabel: ROLE_LABELS[user.role],
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      permissions: (user.permissions ?? []).map((p) => p.permissionKey).sort(),
    };
  }

  /** Yalnızca eşit veya daha düşük seviyedeki roller yönetilebilir; süper yönetici her şeyi yönetebilir. */
  private assertCanManageRole(actor: AuthenticatedUser, targetRole: UserRole): void {
    if (actor.role === UserRole.SUPER_ADMIN) return;
    if (ROLE_RANK[targetRole] >= ROLE_RANK[actor.role]) {
      throw AppError.forbidden('USER_CANNOT_MODIFY_SUPER_ADMIN');
    }
  }

  async list(query: ListUsersQueryDto): Promise<{ items: UserSummary[]; total: number; page: number; pageSize: number }> {
    const where: Prisma.UserWhereInput = {
      ...(query.role ? { role: query.role } : {}),
      ...(query.search
        ? {
            OR: [
              { email: { contains: query.search, mode: 'insensitive' } },
              { fullName: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        include: { permissions: { select: { permissionKey: true } } },
        orderBy: [{ createdAt: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items: items.map((u) => this.toSummary(u)), total, page: query.page, pageSize: query.pageSize };
  }

  async getById(id: string): Promise<UserSummary> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { permissions: { select: { permissionKey: true } } },
    });
    if (!user) throw AppError.notFound('USER_NOT_FOUND');
    return this.toSummary(user);
  }

  /** Aktör, kendi etkin izin kümesinin dışında bir izni başkasına veremez (API belirteç kapsamlarıyla aynı kural). */
  private assertPermissionsWithin(actor: AuthenticatedUser, permissions: string[] | undefined): void {
    if (!permissions?.length) return;
    const granted = new Set(actor.permissions);
    if (permissions.some((p) => !granted.has(p))) throw AppError.forbidden('USER_PERMISSION_EXCEEDS');
  }

  async create(actor: AuthenticatedUser, dto: CreateUserDto, ipAddress: string | null): Promise<UserSummary> {
    this.assertCanManageRole(actor, dto.role);
    this.assertPermissionsWithin(actor, dto.permissions);
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw AppError.conflict('AUTH_EMAIL_IN_USE');

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        fullName: dto.fullName,
        passwordHash: await hashPassword(dto.password),
        role: dto.role,
        permissions: dto.permissions?.length
          ? { create: [...new Set(dto.permissions)].map((permissionKey) => ({ permissionKey })) }
          : undefined,
      },
      include: { permissions: { select: { permissionKey: true } } },
    });

    await this.audit.record({
      userId: actor.id,
      actorLabel: actor.email,
      action: 'user.create',
      resourceType: 'user',
      resourceId: user.id,
      ipAddress,
      result: AuditResult.SUCCESS,
      metadata: { email: user.email, role: user.role, permissions: dto.permissions ?? [] },
    });
    return this.toSummary(user);
  }

  async update(actor: AuthenticatedUser, id: string, dto: UpdateUserDto, ipAddress: string | null): Promise<UserSummary> {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw AppError.notFound('USER_NOT_FOUND');

    if (actor.id === id && ((dto.role !== undefined && dto.role !== target.role) || dto.isActive === false)) {
      throw AppError.forbidden('USER_CANNOT_MODIFY_SELF_ROLE');
    }

    this.assertCanManageRole(actor, target.role);
    if (dto.role !== undefined) this.assertCanManageRole(actor, dto.role);
    this.assertPermissionsWithin(actor, dto.permissions);

    const demotingSuperAdmin =
      target.role === UserRole.SUPER_ADMIN &&
      ((dto.role !== undefined && dto.role !== UserRole.SUPER_ADMIN) || dto.isActive === false);
    if (demotingSuperAdmin) {
      const activeSuperAdmins = await this.prisma.user.count({
        where: { role: UserRole.SUPER_ADMIN, isActive: true, id: { not: id } },
      });
      if (activeSuperAdmins === 0) throw AppError.forbidden('USER_LAST_SUPER_ADMIN');
    }

    const data: Prisma.UserUpdateInput = {};
    if (dto.fullName !== undefined) data.fullName = dto.fullName;
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.newPassword !== undefined) data.passwordHash = await hashPassword(dto.newPassword);
    if (dto.permissions !== undefined) {
      data.permissions = {
        deleteMany: {},
        create: [...new Set(dto.permissions)].map((permissionKey) => ({ permissionKey })),
      };
    }

    const user = await this.prisma.user.update({
      where: { id },
      data,
      include: { permissions: { select: { permissionKey: true } } },
    });

    let revokedSessions = 0;
    if (dto.isActive === false || dto.newPassword !== undefined || (dto.role !== undefined && dto.role !== target.role)) {
      revokedSessions = await this.sessions.revokeAllForUser(id);
    }

    await this.audit.record({
      userId: actor.id,
      actorLabel: actor.email,
      action: 'user.update',
      resourceType: 'user',
      resourceId: id,
      ipAddress,
      result: AuditResult.SUCCESS,
      metadata: {
        changes: {
          fullName: dto.fullName,
          role: dto.role,
          isActive: dto.isActive,
          permissions: dto.permissions,
          passwordReset: dto.newPassword !== undefined,
        },
        revokedSessions,
      },
    });
    return this.toSummary(user);
  }
}
