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

// ---------------------------------------------------------------------------
// Sunucular
// ---------------------------------------------------------------------------

export type OsFamily = 'WINDOWS' | 'LINUX';
export type ServerStatus = 'PENDING' | 'ONLINE' | 'OFFLINE' | 'DEGRADED';
export type AgentStatus = 'NEVER_CONNECTED' | 'CONNECTED' | 'DISCONNECTED' | 'REVOKED';
export type CredentialStatus = 'ACTIVE' | 'ROTATED' | 'REVOKED';
export type AgentEventType = 'CONNECTED' | 'DISCONNECTED' | 'REGISTERED' | 'CREDENTIAL_ROTATED' | 'CREDENTIAL_REVOKED' | 'VERSION_CHANGED';

export const OS_FAMILY_LABELS: Record<OsFamily, string> = { WINDOWS: 'Windows', LINUX: 'Linux' };

export const SERVER_STATUS_LABELS: Record<ServerStatus, string> = {
  PENDING: 'Bekliyor',
  ONLINE: 'Çevrimiçi',
  OFFLINE: 'Çevrimdışı',
  DEGRADED: 'Sorunlu',
};

export const AGENT_STATUS_LABELS: Record<AgentStatus, string> = {
  NEVER_CONNECTED: 'Hiç bağlanmadı',
  CONNECTED: 'Bağlı',
  DISCONNECTED: 'Bağlantı kesildi',
  REVOKED: 'İptal edildi',
};

export const AGENT_EVENT_LABELS: Record<AgentEventType, string> = {
  CONNECTED: 'Bağlandı',
  DISCONNECTED: 'Bağlantı kesildi',
  REGISTERED: 'Kaydedildi',
  CREDENTIAL_ROTATED: 'Kimlik bilgisi yenilendi',
  CREDENTIAL_REVOKED: 'Kimlik bilgisi iptal edildi',
  VERSION_CHANGED: 'Sürüm değişti',
};

export interface ServerMetricsSnapshot {
  timestamp: string;
  cpuPercent: number;
  memoryPercent: number;
  memoryUsedBytes: string;
  memoryTotalBytes: string;
  uptimeSeconds: number | null;
  diskUsedPercent: number | null;
  diskTotalBytes: string;
  diskUsedBytes: string;
}

export interface ServerGroupRef {
  id: string;
  name: string;
  color: string | null;
}

export interface TagRef {
  id: string;
  name: string;
  color: string | null;
}

export interface ServerListItem {
  id: string;
  name: string;
  description: string | null;
  hostname: string | null;
  osFamily: OsFamily;
  osName: string | null;
  osVersion: string | null;
  architecture: string | null;
  status: ServerStatus;
  lastHeartbeatAt: string | null;
  registeredAt: string;
  group: ServerGroupRef | null;
  tags: TagRef[];
  agent: { status: AgentStatus; version: string | null } | null;
  metrics: ServerMetricsSnapshot | null;
}

export interface ServerDetail extends Omit<ServerListItem, 'agent'> {
  osEdition: string | null;
  kernelVersion: string | null;
  cpuModel: string | null;
  cpuCores: number | null;
  totalMemoryBytes: string | null;
  bootTime: string | null;
  createdAt: string;
  updatedAt: string;
  agent: {
    id: string;
    status: AgentStatus;
    version: string | null;
    lastConnectedAt: string | null;
    lastDisconnectedAt: string | null;
    lastIpAddress: string | null;
    collectionIntervalSec: number;
    credential: { keyId: string; status: CredentialStatus; issuedAt: string; lastUsedAt: string | null; revokedAt: string | null } | null;
  } | null;
  disks: { volume: string; timestamp: string; totalBytes: string; usedBytes: string; freeBytes: string; usedPercent: number; readBps: number | null; writeBps: number | null }[];
  network: { name: string; timestamp: string; rxBps: number; txBps: number; isUp: boolean }[];
}

export interface ServerGroup extends ServerGroupRef {
  description: string | null;
  serverCount: number;
  createdAt: string;
}

export interface Tag extends TagRef {
  serverCount: number;
}

export interface AgentEvent {
  id: string;
  type: AgentEventType;
  ipAddress: string | null;
  agentVersion: string | null;
  detail: string | null;
  createdAt: string;
}

export interface RegistrationTokenRecord {
  id: string;
  tokenPrefix: string;
  osFamily: OsFamily;
  osVersion: string | null;
  architecture: string | null;
  serverName: string | null;
  groupId: string | null;
  createdById: string;
  createdByEmail?: string;
  expiresAt: string;
  usedAt: string | null;
  usedByServerId: string | null;
  revokedAt: string | null;
  createdAt: string;
  status: 'ACTIVE' | 'USED' | 'EXPIRED' | 'REVOKED';
}

export interface PlatformCatalog {
  osVersions: Record<OsFamily, string[]>;
  architectures: readonly string[];
}

export const OS_VERSION_LABELS: Record<string, string> = {
  'windows-server-2019': 'Windows Server 2019',
  'windows-server-2022': 'Windows Server 2022',
  'windows-server-2025': 'Windows Server 2025',
  'ubuntu-22.04': 'Ubuntu Server 22.04 LTS',
  'ubuntu-24.04': 'Ubuntu Server 24.04 LTS',
  'debian-12': 'Debian 12',
};

export interface DashboardSummary {
  servers: { total: number; online: number; offline: number; degraded: number; pending: number; windows: number; linux: number };
  availabilityPercent: number | null;
  activeIncidents: number;
  usage: { avgCpuPercent: number | null; avgMemoryPercent: number | null; diskUsedPercent: number | null; diskTotalBytes: string; diskUsedBytes: string; sampledServers: number };
  recentEvents: { id: string; type: AgentEventType; serverId: string; serverName: string; detail: string | null; agentVersion: string | null; createdAt: string }[];
  generatedAt: string;
}

export interface RealtimeEvent {
  type: 'hello' | 'server.registered' | 'server.updated' | 'server.status' | 'server.deleted' | 'server.metrics' | 'agent.revoked' | 'incident.created' | 'incident.updated' | 'check.status';
  payload: Record<string, unknown>;
  at: string;
}

// ---------------------------------------------------------------------------
// Olaylar, bildirimler, erişilebilirlik
// ---------------------------------------------------------------------------

export type IncidentType = 'SERVER_UNAVAILABLE' | 'AGENT_DISCONNECTED' | 'SERVICE_FAILURE' | 'HIGH_CPU' | 'HIGH_MEMORY' | 'LOW_DISK' | 'NETWORK_FAILURE' | 'SSL_EXPIRING' | 'CHECK_DOWN';
export type IncidentSeverity = 'INFO' | 'WARNING' | 'CRITICAL';
export type IncidentStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';

export const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = { OPEN: 'Açık', ACKNOWLEDGED: 'Üstlenildi', RESOLVED: 'Çözüldü' };

export interface IncidentListItem {
  id: string;
  type: IncidentType;
  typeLabel: string;
  severity: IncidentSeverity;
  severityLabel: string;
  status: IncidentStatus;
  title: string;
  description: string | null;
  server: { id: string; name: string } | null;
  check: { id: string; name: string } | null;
  startedAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  durationSeconds: number;
  updatedAt: string;
}

export interface IncidentDetail extends IncidentListItem {
  events: { id: string; kind: string; message: string; userName: string | null; createdAt: string }[];
  notifications: { id: string; channelName: string; channelType: NotificationChannelType; eventType: string; status: NotificationStatus; attempts: number; lastError: string | null; sentAt: string | null }[];
}

export type NotificationChannelType = 'DISCORD' | 'TELEGRAM' | 'EMAIL';
export type NotificationStatus = 'PENDING' | 'SENT' | 'FAILED';

export interface NotificationChannel {
  id: string;
  name: string;
  type: NotificationChannelType;
  config?: Record<string, unknown>;
  enabledEvents: string[];
  isEnabled: boolean;
  lastTestedAt: string | null;
  lastTestResult: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationCatalog {
  events: { key: string; label: string }[];
  types: { value: NotificationChannelType; label: string }[];
}

export interface RecentNotification {
  id: string;
  channelName: string;
  channelType: NotificationChannelType;
  eventType: string;
  eventLabel: string;
  incident: { id: string; title: string } | null;
  status: NotificationStatus;
  attempts: number;
  lastError: string | null;
  sentAt: string | null;
  createdAt: string;
}

export type CheckType = 'HTTP' | 'HTTPS' | 'TCP' | 'ICMP';
export type CheckStatus = 'PENDING' | 'UP' | 'DOWN';
export const CHECK_STATUS_LABELS: Record<CheckStatus, string> = { PENDING: 'Bekliyor', UP: 'Erişilebilir', DOWN: 'Erişilemiyor' };

export interface UptimeCheck {
  id: string;
  name: string;
  type: CheckType;
  typeLabel: string;
  target: string;
  port: number | null;
  method: string | null;
  expectedStatusCode: number | null;
  intervalSec: number;
  timeoutSec: number;
  retryCount: number;
  failureThreshold: number;
  recoveryThreshold: number;
  sslExpiryWarnDays: number | null;
  sslExpiresAt: string | null;
  notifyOnFailure: boolean;
  isEnabled: boolean;
  status: CheckStatus;
  consecutiveFails: number;
  consecutiveOks: number;
  lastCheckedAt: string | null;
  lastStatusChangeAt: string | null;
  lastResponseMs: number | null;
  server: { id: string; name: string } | null;
  uptime24h: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface UptimeCheckDetail extends UptimeCheck {
  uptime7d: number | null;
  uptime30d: number | null;
  activeIncidents: { id: string; type: IncidentType; severity: IncidentSeverity; title: string; startedAt: string }[];
}

export interface CheckResultItem {
  id: string;
  checkedAt: string;
  isUp: boolean;
  responseTimeMs: number | null;
  statusCode: number | null;
  errorMessage: string | null;
  sslExpiresAt: string | null;
}

export interface CheckHistory {
  range: { from: string; to: string; bucketSeconds: number };
  points: { t: string; avgMs: number | null; maxMs: number | null; availability: number | null; samples: number }[];
}
