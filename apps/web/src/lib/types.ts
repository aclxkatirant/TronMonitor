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
  type: 'hello' | 'server.registered' | 'server.updated' | 'server.status' | 'server.deleted' | 'server.metrics' | 'agent.revoked';
  payload: Record<string, unknown>;
  at: string;
}
