import { UserRole } from '../generated/prisma/client';
import { ALL_PERMISSIONS, PERMISSIONS, PERMISSION_DESCRIPTIONS, ROLE_DEFAULT_PERMISSIONS, ROLE_RANK } from './permission-catalog';
import { PermissionsService } from './permissions.service';

describe('izin kataloğu', () => {
  it('her izin için Türkçe açıklama bulunur', () => {
    for (const key of ALL_PERMISSIONS) {
      expect(PERMISSION_DESCRIPTIONS[key]).toBeTruthy();
    }
  });

  it('izleyici hiçbir değiştirici izne sahip değildir', () => {
    const viewer = ROLE_DEFAULT_PERMISSIONS[UserRole.VIEWER];
    expect(viewer).not.toContain(PERMISSIONS.TERMINAL_USE);
    expect(viewer).not.toContain(PERMISSIONS.SERVERS_MANAGE);
    expect(viewer).not.toContain(PERMISSIONS.SERVICES_CONTROL);
    expect(viewer).not.toContain(PERMISSIONS.USERS_MANAGE);
    expect(viewer).toContain(PERMISSIONS.SERVERS_READ);
  });

  it('operatör yalnızca okuma ve olay yönetimi alır', () => {
    const operator = ROLE_DEFAULT_PERMISSIONS[UserRole.OPERATOR];
    expect(operator).toContain(PERMISSIONS.INCIDENTS_MANAGE);
    expect(operator).not.toContain(PERMISSIONS.TERMINAL_USE);
    expect(operator).not.toContain(PERMISSIONS.SERVICES_CONTROL);
  });

  it('yönetici sistem ayarlarını değiştiremez, süper yönetici her şeyi yapabilir', () => {
    expect(ROLE_DEFAULT_PERMISSIONS[UserRole.ADMIN]).not.toContain(PERMISSIONS.SETTINGS_MANAGE);
    expect(ROLE_DEFAULT_PERMISSIONS[UserRole.SUPER_ADMIN]).toEqual(ALL_PERMISSIONS);
  });

  it('rol sıralaması tutarlıdır', () => {
    expect(ROLE_RANK.SUPER_ADMIN).toBeGreaterThan(ROLE_RANK.ADMIN);
    expect(ROLE_RANK.ADMIN).toBeGreaterThan(ROLE_RANK.OPERATOR);
    expect(ROLE_RANK.OPERATOR).toBeGreaterThan(ROLE_RANK.VIEWER);
  });

  it('hasAll tüm gerekli izinleri ister', () => {
    expect(PermissionsService.hasAll(['servers.read', 'servers.manage'], [PERMISSIONS.SERVERS_READ])).toBe(true);
    expect(PermissionsService.hasAll(['servers.read'], [PERMISSIONS.SERVERS_READ, PERMISSIONS.SERVERS_MANAGE])).toBe(false);
    expect(PermissionsService.hasAll([], [])).toBe(true);
  });
});
