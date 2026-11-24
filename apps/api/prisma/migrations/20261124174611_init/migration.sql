-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "OsFamily" AS ENUM ('WINDOWS', 'LINUX');

-- CreateEnum
CREATE TYPE "ServerStatus" AS ENUM ('PENDING', 'ONLINE', 'OFFLINE', 'DEGRADED');

-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM ('NEVER_CONNECTED', 'CONNECTED', 'DISCONNECTED', 'REVOKED');

-- CreateEnum
CREATE TYPE "CredentialStatus" AS ENUM ('ACTIVE', 'ROTATED', 'REVOKED');

-- CreateEnum
CREATE TYPE "AgentEventType" AS ENUM ('CONNECTED', 'DISCONNECTED', 'REGISTERED', 'CREDENTIAL_ROTATED', 'CREDENTIAL_REVOKED', 'VERSION_CHANGED');

-- CreateEnum
CREATE TYPE "AggregateResolution" AS ENUM ('MINUTE_5', 'HOUR_1', 'DAY_1');

-- CreateEnum
CREATE TYPE "ServiceState" AS ENUM ('RUNNING', 'STOPPED', 'STARTING', 'STOPPING', 'FAILED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "CheckType" AS ENUM ('HTTP', 'HTTPS', 'TCP', 'ICMP');

-- CreateEnum
CREATE TYPE "CheckStatus" AS ENUM ('PENDING', 'UP', 'DOWN');

-- CreateEnum
CREATE TYPE "IncidentType" AS ENUM ('SERVER_UNAVAILABLE', 'AGENT_DISCONNECTED', 'SERVICE_FAILURE', 'HIGH_CPU', 'HIGH_MEMORY', 'LOW_DISK', 'NETWORK_FAILURE', 'SSL_EXPIRING', 'CHECK_DOWN');

-- CreateEnum
CREATE TYPE "IncidentSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "NotificationChannelType" AS ENUM ('DISCORD', 'TELEGRAM', 'EMAIL');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "TerminalProtocol" AS ENUM ('SSH', 'WINRM');

-- CreateEnum
CREATE TYPE "CredentialType" AS ENUM ('SSH_KEY', 'SSH_PASSWORD', 'WINRM_PASSWORD');

-- CreateEnum
CREATE TYPE "TerminalSessionStatus" AS ENUM ('CONNECTING', 'ACTIVE', 'CLOSED', 'FAILED', 'TIMED_OUT', 'TERMINATED');

-- CreateEnum
CREATE TYPE "AuditResult" AS ENUM ('SUCCESS', 'FAILURE', 'DENIED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'VIEWER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "role" "UserRole" NOT NULL,
    "permissionKey" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("role","permissionKey")
);

-- CreateTable
CREATE TABLE "UserPermission" (
    "userId" TEXT NOT NULL,
    "permissionKey" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserPermission_pkey" PRIMARY KEY ("userId","permissionKey")
);

-- CreateTable
CREATE TABLE "ServerPermission" (
    "userId" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "permissions" TEXT[],
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServerPermission_pkey" PRIMARY KEY ("userId","serverId")
);

-- CreateTable
CREATE TABLE "UserSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "scopes" TEXT[],
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServerGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServerGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServerTag" (
    "serverId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "ServerTag_pkey" PRIMARY KEY ("serverId","tagId")
);

-- CreateTable
CREATE TABLE "Server" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "hostname" TEXT,
    "osFamily" "OsFamily" NOT NULL,
    "osName" TEXT,
    "osVersion" TEXT,
    "osEdition" TEXT,
    "kernelVersion" TEXT,
    "architecture" TEXT,
    "cpuModel" TEXT,
    "cpuCores" INTEGER,
    "totalMemoryBytes" BIGINT,
    "status" "ServerStatus" NOT NULL DEFAULT 'PENDING',
    "lastHeartbeatAt" TIMESTAMP(3),
    "bootTime" TIMESTAMP(3),
    "groupId" TEXT,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Server_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "version" TEXT,
    "status" "AgentStatus" NOT NULL DEFAULT 'NEVER_CONNECTED',
    "lastConnectedAt" TIMESTAMP(3),
    "lastDisconnectedAt" TIMESTAMP(3),
    "lastIpAddress" TEXT,
    "collectionIntervalSec" INTEGER NOT NULL DEFAULT 15,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentCredential" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "status" "CredentialStatus" NOT NULL DEFAULT 'ACTIVE',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "AgentCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentConnectionEvent" (
    "id" BIGSERIAL NOT NULL,
    "agentId" TEXT NOT NULL,
    "type" "AgentEventType" NOT NULL,
    "ipAddress" TEXT,
    "agentVersion" TEXT,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentConnectionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistrationToken" (
    "id" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "osFamily" "OsFamily" NOT NULL,
    "osVersion" TEXT,
    "architecture" TEXT,
    "serverName" TEXT,
    "groupId" TEXT,
    "createdById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "usedByServerId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegistrationToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricSample" (
    "serverId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "cpuPercent" DOUBLE PRECISION NOT NULL,
    "memoryTotalBytes" BIGINT NOT NULL,
    "memoryUsedBytes" BIGINT NOT NULL,
    "memoryPercent" DOUBLE PRECISION NOT NULL,
    "loadAvg1" DOUBLE PRECISION,
    "loadAvg5" DOUBLE PRECISION,
    "loadAvg15" DOUBLE PRECISION,
    "diskReadBps" DOUBLE PRECISION,
    "diskWriteBps" DOUBLE PRECISION,
    "netRxBps" DOUBLE PRECISION,
    "netTxBps" DOUBLE PRECISION,
    "uptimeSeconds" BIGINT,

    CONSTRAINT "MetricSample_pkey" PRIMARY KEY ("serverId","timestamp")
);

-- CreateTable
CREATE TABLE "DiskSample" (
    "serverId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "volume" TEXT NOT NULL,
    "totalBytes" BIGINT NOT NULL,
    "usedBytes" BIGINT NOT NULL,
    "freeBytes" BIGINT NOT NULL,
    "readBps" DOUBLE PRECISION,
    "writeBps" DOUBLE PRECISION,

    CONSTRAINT "DiskSample_pkey" PRIMARY KEY ("serverId","timestamp","volume")
);

-- CreateTable
CREATE TABLE "NetworkInterfaceSample" (
    "serverId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "interfaceName" TEXT NOT NULL,
    "rxBps" DOUBLE PRECISION NOT NULL,
    "txBps" DOUBLE PRECISION NOT NULL,
    "isUp" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "NetworkInterfaceSample_pkey" PRIMARY KEY ("serverId","timestamp","interfaceName")
);

-- CreateTable
CREATE TABLE "MetricAggregate" (
    "serverId" TEXT NOT NULL,
    "bucketStart" TIMESTAMP(3) NOT NULL,
    "resolution" "AggregateResolution" NOT NULL,
    "cpuAvg" DOUBLE PRECISION NOT NULL,
    "cpuMax" DOUBLE PRECISION NOT NULL,
    "memoryAvg" DOUBLE PRECISION NOT NULL,
    "memoryMax" DOUBLE PRECISION NOT NULL,
    "diskUsedPctAvg" DOUBLE PRECISION,
    "netRxBpsAvg" DOUBLE PRECISION,
    "netTxBpsAvg" DOUBLE PRECISION,
    "sampleCount" INTEGER NOT NULL,

    CONSTRAINT "MetricAggregate_pkey" PRIMARY KEY ("serverId","resolution","bucketStart")
);

-- CreateTable
CREATE TABLE "MonitoredService" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT,
    "state" "ServiceState" NOT NULL DEFAULT 'UNKNOWN',
    "startupType" TEXT,
    "isEnabled" BOOLEAN,
    "isMonitored" BOOLEAN NOT NULL DEFAULT false,
    "lastStateChangeAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonitoredService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceStateEvent" (
    "id" BIGSERIAL NOT NULL,
    "serviceId" TEXT NOT NULL,
    "fromState" "ServiceState" NOT NULL,
    "toState" "ServiceState" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceStateEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitoringCheck" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CheckType" NOT NULL,
    "target" TEXT NOT NULL,
    "port" INTEGER,
    "method" TEXT,
    "expectedStatusCode" INTEGER,
    "intervalSec" INTEGER NOT NULL DEFAULT 60,
    "timeoutSec" INTEGER NOT NULL DEFAULT 10,
    "retryCount" INTEGER NOT NULL DEFAULT 2,
    "failureThreshold" INTEGER NOT NULL DEFAULT 3,
    "recoveryThreshold" INTEGER NOT NULL DEFAULT 2,
    "sslExpiryWarnDays" INTEGER,
    "notifyOnFailure" BOOLEAN NOT NULL DEFAULT true,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "status" "CheckStatus" NOT NULL DEFAULT 'PENDING',
    "consecutiveFails" INTEGER NOT NULL DEFAULT 0,
    "consecutiveOks" INTEGER NOT NULL DEFAULT 0,
    "lastCheckedAt" TIMESTAMP(3),
    "lastStatusChangeAt" TIMESTAMP(3),
    "lastResponseMs" INTEGER,
    "sslExpiresAt" TIMESTAMP(3),
    "serverId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonitoringCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckResult" (
    "id" BIGSERIAL NOT NULL,
    "checkId" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isUp" BOOLEAN NOT NULL,
    "responseTimeMs" INTEGER,
    "statusCode" INTEGER,
    "errorMessage" TEXT,
    "sslExpiresAt" TIMESTAMP(3),

    CONSTRAINT "CheckResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "type" "IncidentType" NOT NULL,
    "severity" "IncidentSeverity" NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "serverId" TEXT,
    "checkId" TEXT,
    "serviceId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentEvent" (
    "id" BIGSERIAL NOT NULL,
    "incidentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationChannel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "NotificationChannelType" NOT NULL,
    "encryptedConfig" TEXT NOT NULL,
    "enabledEvents" TEXT[],
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lastTestedAt" TIMESTAMP(3),
    "lastTestResult" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "incidentId" TEXT,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServerCredential" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "type" "CredentialType" NOT NULL,
    "username" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "encryptedSecret" TEXT NOT NULL,
    "hostFingerprint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServerCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TerminalSession" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "protocol" "TerminalProtocol" NOT NULL,
    "status" "TerminalSessionStatus" NOT NULL DEFAULT 'CONNECTING',
    "clientIp" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "endReason" TEXT,

    CONSTRAINT "TerminalSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TerminalCommandLog" (
    "id" BIGSERIAL NOT NULL,
    "sessionId" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TerminalCommandLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" BIGSERIAL NOT NULL,
    "userId" TEXT,
    "actorLabel" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resourceType" TEXT,
    "resourceId" TEXT,
    "ipAddress" TEXT,
    "result" "AuditResult" NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE UNIQUE INDEX "UserSession_tokenHash_key" ON "UserSession"("tokenHash");

-- CreateIndex
CREATE INDEX "UserSession_userId_idx" ON "UserSession"("userId");

-- CreateIndex
CREATE INDEX "UserSession_expiresAt_idx" ON "UserSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApiToken_tokenHash_key" ON "ApiToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ApiToken_userId_idx" ON "ApiToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ServerGroup_name_key" ON "ServerGroup"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE INDEX "Server_status_idx" ON "Server"("status");

-- CreateIndex
CREATE INDEX "Server_osFamily_idx" ON "Server"("osFamily");

-- CreateIndex
CREATE INDEX "Server_groupId_idx" ON "Server"("groupId");

-- CreateIndex
CREATE INDEX "Server_name_idx" ON "Server"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_serverId_key" ON "Agent"("serverId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentCredential_keyId_key" ON "AgentCredential"("keyId");

-- CreateIndex
CREATE INDEX "AgentCredential_agentId_status_idx" ON "AgentCredential"("agentId", "status");

-- CreateIndex
CREATE INDEX "AgentConnectionEvent_agentId_createdAt_idx" ON "AgentConnectionEvent"("agentId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "RegistrationToken_tokenHash_key" ON "RegistrationToken"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "RegistrationToken_usedByServerId_key" ON "RegistrationToken"("usedByServerId");

-- CreateIndex
CREATE INDEX "RegistrationToken_expiresAt_idx" ON "RegistrationToken"("expiresAt");

-- CreateIndex
CREATE INDEX "MetricSample_timestamp_idx" ON "MetricSample"("timestamp");

-- CreateIndex
CREATE INDEX "DiskSample_timestamp_idx" ON "DiskSample"("timestamp");

-- CreateIndex
CREATE INDEX "NetworkInterfaceSample_timestamp_idx" ON "NetworkInterfaceSample"("timestamp");

-- CreateIndex
CREATE INDEX "MetricAggregate_bucketStart_idx" ON "MetricAggregate"("bucketStart");

-- CreateIndex
CREATE INDEX "MonitoredService_serverId_isMonitored_idx" ON "MonitoredService"("serverId", "isMonitored");

-- CreateIndex
CREATE UNIQUE INDEX "MonitoredService_serverId_name_key" ON "MonitoredService"("serverId", "name");

-- CreateIndex
CREATE INDEX "ServiceStateEvent_serviceId_createdAt_idx" ON "ServiceStateEvent"("serviceId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "MonitoringCheck_isEnabled_idx" ON "MonitoringCheck"("isEnabled");

-- CreateIndex
CREATE INDEX "MonitoringCheck_serverId_idx" ON "MonitoringCheck"("serverId");

-- CreateIndex
CREATE INDEX "CheckResult_checkId_checkedAt_idx" ON "CheckResult"("checkId", "checkedAt" DESC);

-- CreateIndex
CREATE INDEX "CheckResult_checkedAt_idx" ON "CheckResult"("checkedAt");

-- CreateIndex
CREATE INDEX "Incident_status_startedAt_idx" ON "Incident"("status", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "Incident_serverId_status_idx" ON "Incident"("serverId", "status");

-- CreateIndex
CREATE INDEX "Incident_type_idx" ON "Incident"("type");

-- CreateIndex
CREATE INDEX "IncidentEvent_incidentId_createdAt_idx" ON "IncidentEvent"("incidentId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_status_createdAt_idx" ON "Notification"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_incidentId_idx" ON "Notification"("incidentId");

-- CreateIndex
CREATE INDEX "ServerCredential_serverId_idx" ON "ServerCredential"("serverId");

-- CreateIndex
CREATE INDEX "TerminalSession_serverId_startedAt_idx" ON "TerminalSession"("serverId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "TerminalSession_userId_idx" ON "TerminalSession"("userId");

-- CreateIndex
CREATE INDEX "TerminalCommandLog_sessionId_executedAt_idx" ON "TerminalCommandLog"("sessionId", "executedAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_resourceType_resourceId_idx" ON "AuditLog"("resourceType", "resourceId");

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionKey_fkey" FOREIGN KEY ("permissionKey") REFERENCES "Permission"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPermission" ADD CONSTRAINT "UserPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPermission" ADD CONSTRAINT "UserPermission_permissionKey_fkey" FOREIGN KEY ("permissionKey") REFERENCES "Permission"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServerPermission" ADD CONSTRAINT "ServerPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServerPermission" ADD CONSTRAINT "ServerPermission_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServerTag" ADD CONSTRAINT "ServerTag_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServerTag" ADD CONSTRAINT "ServerTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Server" ADD CONSTRAINT "Server_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ServerGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentCredential" ADD CONSTRAINT "AgentCredential_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentConnectionEvent" ADD CONSTRAINT "AgentConnectionEvent_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationToken" ADD CONSTRAINT "RegistrationToken_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationToken" ADD CONSTRAINT "RegistrationToken_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ServerGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationToken" ADD CONSTRAINT "RegistrationToken_usedByServerId_fkey" FOREIGN KEY ("usedByServerId") REFERENCES "Server"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricSample" ADD CONSTRAINT "MetricSample_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiskSample" ADD CONSTRAINT "DiskSample_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NetworkInterfaceSample" ADD CONSTRAINT "NetworkInterfaceSample_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricAggregate" ADD CONSTRAINT "MetricAggregate_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoredService" ADD CONSTRAINT "MonitoredService_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceStateEvent" ADD CONSTRAINT "ServiceStateEvent_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "MonitoredService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringCheck" ADD CONSTRAINT "MonitoringCheck_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringCheck" ADD CONSTRAINT "MonitoringCheck_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckResult" ADD CONSTRAINT "CheckResult_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "MonitoringCheck"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "MonitoringCheck"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "MonitoredService"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_acknowledgedById_fkey" FOREIGN KEY ("acknowledgedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentEvent" ADD CONSTRAINT "IncidentEvent_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentEvent" ADD CONSTRAINT "IncidentEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "NotificationChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServerCredential" ADD CONSTRAINT "ServerCredential_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TerminalSession" ADD CONSTRAINT "TerminalSession_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TerminalSession" ADD CONSTRAINT "TerminalSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TerminalCommandLog" ADD CONSTRAINT "TerminalCommandLog_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TerminalSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
