import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { UserRole } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ALL_PERMISSIONS,
  PERMISSION_DESCRIPTIONS,
  ROLE_DEFAULT_PERMISSIONS,
  type PermissionKey,
} from './permission-catalog';

const ROLE_CACHE_TTL_MS = 30_000;

interface RoleCacheEntry {
  permissions: Set<string>;
  loadedAt: number;
}

@Injectable()
export class PermissionsService implements OnModuleInit {
  private readonly logger = new Logger(PermissionsService.name);
  private readonly roleCache = new Map<UserRole, RoleCacheEntry>();

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.syncCatalog();
  }

  /**
   * İzin kataloğunu veritabanıyla eşitler. Rol varsayılanları yalnızca rolün hiç kaydı yoksa yazılır;
   * böylece yöneticilerin yaptığı özelleştirmeler korunur.
   */
  async syncCatalog(): Promise<void> {
    for (const key of ALL_PERMISSIONS) {
      await this.prisma.permission.upsert({
        where: { key },
        create: { key, description: PERMISSION_DESCRIPTIONS[key] },
        update: { description: PERMISSION_DESCRIPTIONS[key] },
      });
    }

    for (const role of Object.values(UserRole)) {
      const existing = await this.prisma.rolePermission.count({ where: { role } });
      if (existing === 0) {
        await this.prisma.rolePermission.createMany({
          data: ROLE_DEFAULT_PERMISSIONS[role].map((permissionKey) => ({ role, permissionKey })),
          skipDuplicates: true,
        });
      }
    }
    this.roleCache.clear();
    this.logger.log('İzin kataloğu eşitlendi');
  }

  async getRolePermissions(role: UserRole): Promise<Set<string>> {
    const cached = this.roleCache.get(role);
    if (cached && Date.now() - cached.loadedAt < ROLE_CACHE_TTL_MS) {
      return cached.permissions;
    }
    const rows = await this.prisma.rolePermission.findMany({
      where: { role },
      select: { permissionKey: true },
    });
    const permissions = new Set(rows.map((row) => row.permissionKey));
    this.roleCache.set(role, { permissions, loadedAt: Date.now() });
    return permissions;
  }

  /** Rol varsayılanları ile kullanıcıya özel atanan izinlerin birleşimi. */
  async getEffectivePermissions(userId: string, role: UserRole): Promise<string[]> {
    const rolePermissions = await this.getRolePermissions(role);
    const userRows = await this.prisma.userPermission.findMany({
      where: { userId },
      select: { permissionKey: true },
    });
    const effective = new Set<string>(rolePermissions);
    for (const row of userRows) effective.add(row.permissionKey);
    return [...effective].sort();
  }

  static hasAll(granted: ReadonlyArray<string>, required: ReadonlyArray<PermissionKey>): boolean {
    const set = new Set(granted);
    return required.every((key) => set.has(key));
  }

  invalidateCache(): void {
    this.roleCache.clear();
  }
}
