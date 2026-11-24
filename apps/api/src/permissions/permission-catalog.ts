import { UserRole } from '../generated/prisma/client';

/**
 * Sistemdeki tüm izin anahtarları. Yeni bir yetenek eklendiğinde buraya anahtar eklenir;
 * veritabanındaki Permission tablosu açılışta bu katalogla eşitlenir.
 */
export const PERMISSIONS = {
  DASHBOARD_READ: 'dashboard.read',
  SERVERS_READ: 'servers.read',
  SERVERS_MANAGE: 'servers.manage',
  SERVERS_REGISTER: 'servers.register',
  SERVERS_DELETE: 'servers.delete',
  AGENTS_MANAGE: 'agents.manage',
  METRICS_READ: 'metrics.read',
  SERVICES_READ: 'services.read',
  SERVICES_MANAGE: 'services.manage',
  SERVICES_CONTROL: 'services.control',
  UPTIME_READ: 'uptime.read',
  UPTIME_MANAGE: 'uptime.manage',
  INCIDENTS_READ: 'incidents.read',
  INCIDENTS_MANAGE: 'incidents.manage',
  TERMINAL_USE: 'terminal.use',
  TERMINAL_CREDENTIALS: 'terminal.credentials',
  NOTIFICATIONS_READ: 'notifications.read',
  NOTIFICATIONS_MANAGE: 'notifications.manage',
  AUDIT_READ: 'audit.read',
  API_TOKENS_OWN: 'apitokens.own',
  API_TOKENS_MANAGE_ALL: 'apitokens.manage_all',
  USERS_READ: 'users.read',
  USERS_MANAGE: 'users.manage',
  SETTINGS_READ: 'settings.read',
  SETTINGS_MANAGE: 'settings.manage',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const PERMISSION_DESCRIPTIONS: Record<PermissionKey, string> = {
  'dashboard.read': 'Genel bakış panosunu görüntüleme',
  'servers.read': 'Sunucuları ve ayrıntılarını görüntüleme',
  'servers.manage': 'Sunucu bilgilerini, gruplarını ve etiketlerini düzenleme',
  'servers.register': 'Yeni sunucu kaydetme ve kayıt belirteci oluşturma',
  'servers.delete': 'Sunucu silme',
  'agents.manage': 'Ajan kimlik bilgilerini iptal etme ve ajan bağlantılarını yönetme',
  'metrics.read': 'Performans metriklerini görüntüleme',
  'services.read': 'Hizmet durumlarını görüntüleme',
  'services.manage': 'İzlenecek hizmetleri seçme ve hizmet ayarlarını düzenleme',
  'services.control': 'Hizmetleri başlatma, durdurma ve yeniden başlatma',
  'uptime.read': 'Erişilebilirlik kontrollerini görüntüleme',
  'uptime.manage': 'Erişilebilirlik kontrollerini oluşturma ve düzenleme',
  'incidents.read': 'Olayları görüntüleme',
  'incidents.manage': 'Olayları üstlenme ve çözümleme',
  'terminal.use': 'Web terminali kullanma',
  'terminal.credentials': 'Terminal bağlantı kimlik bilgilerini yönetme',
  'notifications.read': 'Bildirim kanallarını görüntüleme',
  'notifications.manage': 'Bildirim kanallarını ve eşiklerini yönetme',
  'audit.read': 'İşlem kayıtlarını görüntüleme',
  'apitokens.own': 'Kendi API belirteçlerini yönetme',
  'apitokens.manage_all': 'Tüm kullanıcıların API belirteçlerini yönetme',
  'users.read': 'Kullanıcıları görüntüleme',
  'users.manage': 'Kullanıcı oluşturma, düzenleme ve devre dışı bırakma',
  'settings.read': 'Sistem ayarlarını görüntüleme',
  'settings.manage': 'Sistem ayarlarını değiştirme',
};

export const ALL_PERMISSIONS: PermissionKey[] = Object.values(PERMISSIONS);

const READ_ONLY: PermissionKey[] = [
  PERMISSIONS.DASHBOARD_READ,
  PERMISSIONS.SERVERS_READ,
  PERMISSIONS.METRICS_READ,
  PERMISSIONS.SERVICES_READ,
  PERMISSIONS.UPTIME_READ,
  PERMISSIONS.INCIDENTS_READ,
  PERMISSIONS.NOTIFICATIONS_READ,
  PERMISSIONS.API_TOKENS_OWN,
];

/**
 * Rollerin varsayılan izinleri. Operatör yalnızca okuma + olay yönetimi alır; diğer işlemler
 * kullanıcı bazında açıkça atanmalıdır.
 */
export const ROLE_DEFAULT_PERMISSIONS: Record<UserRole, PermissionKey[]> = {
  [UserRole.SUPER_ADMIN]: ALL_PERMISSIONS,
  [UserRole.ADMIN]: ALL_PERMISSIONS.filter((key) => key !== PERMISSIONS.SETTINGS_MANAGE),
  [UserRole.OPERATOR]: [...READ_ONLY, PERMISSIONS.INCIDENTS_MANAGE],
  [UserRole.VIEWER]: READ_ONLY,
};

export const ROLE_LABELS: Record<UserRole, string> = {
  [UserRole.SUPER_ADMIN]: 'Süper Yönetici',
  [UserRole.ADMIN]: 'Yönetici',
  [UserRole.OPERATOR]: 'Operatör',
  [UserRole.VIEWER]: 'İzleyici',
};

/** Rolün yetki seviyesi; daha düşük seviye daha yüksek seviyeyi yönetemez. */
export const ROLE_RANK: Record<UserRole, number> = {
  [UserRole.SUPER_ADMIN]: 4,
  [UserRole.ADMIN]: 3,
  [UserRole.OPERATOR]: 2,
  [UserRole.VIEWER]: 1,
};
