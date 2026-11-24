import { Injectable, Logger } from '@nestjs/common';
import {
  AgentEventType,
  AgentStatus,
  AuditResult,
  CredentialStatus,
  ServerStatus,
  type Prisma,
} from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EncryptionService } from '../common/encryption.service';
import { AppError } from '../common/app-error';
import { generateToken } from '../common/crypto';
import { RegistrationTokensService } from '../registration/registration-tokens.service';
import { RealtimeService } from '../realtime/realtime.service';
import { MetricsService } from '../metrics/metrics.service';
import { IncidentsService } from '../incidents/incidents.service';
import { ServicesService } from '../services/services.service';
import { IncidentSeverity, IncidentType } from '../generated/prisma/client';
import type { AuthenticatedAgent } from './agent-auth.guard';
import type { HeartbeatDto, HostInfoDto, MetricsBatchDto, RegisterAgentDto } from './dto/agent.dto';
import { randomBytes } from 'node:crypto';

export const HEARTBEAT_INTERVAL_SECONDS = 30;
export const OFFLINE_THRESHOLD_SECONDS = 90;
const MAX_SAMPLE_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_SAMPLE_FUTURE_MS = 5 * 60 * 1000;

export interface RegistrationResult {
  agentId: string;
  serverId: string;
  serverName: string;
  keyId: string;
  secret: string;
  collectionIntervalSec: number;
  heartbeatIntervalSec: number;
}

export interface HeartbeatResult {
  serverTime: string;
  collectionIntervalSec: number;
  heartbeatIntervalSec: number;
  serverName: string;
  commands: { id: string; type: string; payload: Record<string, string> }[];
}

interface ServerHostFields {
  hostname: string;
  osName?: string;
  osVersion?: string;
  osEdition?: string;
  kernelVersion?: string;
  architecture?: string;
  cpuModel?: string;
  cpuCores?: number;
  totalMemoryBytes?: bigint;
  bootTime?: Date;
}

function hostInfoToServerData(host: HostInfoDto): ServerHostFields {
  return {
    hostname: host.hostname,
    osName: host.osName,
    osVersion: host.osVersion,
    osEdition: host.osEdition,
    kernelVersion: host.kernelVersion,
    architecture: host.architecture,
    cpuModel: host.cpuModel,
    cpuCores: host.cpuCores,
    totalMemoryBytes: host.totalMemoryBytes !== undefined ? BigInt(Math.round(host.totalMemoryBytes)) : undefined,
    bootTime: host.bootTime ? new Date(host.bootTime) : undefined,
  };
}

@Injectable()
export class AgentsService {
  private readonly logger = new Logger(AgentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly encryption: EncryptionService,
    private readonly registrationTokens: RegistrationTokensService,
    private readonly realtime: RealtimeService,
    private readonly metrics: MetricsService,
    private readonly incidents: IncidentsService,
    private readonly services: ServicesService,
  ) {}

  /**
   * Kayıt belirtecini tek seferlik ajan kimlik bilgisiyle takas eder. Sunucu, ajan ve kimlik bilgisi tek
   * işlemde oluşturulur; belirteç aynı işlemde kullanılmış olarak işaretlenir (yarış koşulu koruması).
   */
  async register(dto: RegisterAgentDto, ipAddress: string | null): Promise<RegistrationResult> {
    const token = await this.registrationTokens.findActiveByPlaintext(dto.registrationToken);
    if (!token) {
      await this.audit.record({
        actorLabel: `agent:${dto.host.hostname}`,
        action: 'agent.register',
        resourceType: 'registration_token',
        ipAddress,
        result: AuditResult.DENIED,
        metadata: { reason: 'invalid_or_expired_token', tokenPrefix: dto.registrationToken.slice(0, 12) },
      });
      throw AppError.unauthorized('REGISTRATION_TOKEN_INVALID');
    }
    if (token.osFamily !== dto.host.osFamily) {
      throw AppError.badRequest('REGISTRATION_OS_MISMATCH');
    }

    const keyId = `tma_${randomBytes(16).toString('hex')}`;
    const secret = generateToken(32);
    const serverName = token.serverName?.trim() || dto.host.hostname;

    const result = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.registrationToken.updateMany({
        where: { id: token.id, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) throw AppError.unauthorized('REGISTRATION_TOKEN_INVALID');

      const server = await tx.server.create({
        data: {
          name: serverName,
          osFamily: dto.host.osFamily,
          groupId: token.groupId,
          status: ServerStatus.ONLINE,
          lastHeartbeatAt: new Date(),
          ...hostInfoToServerData(dto.host),
          agent: {
            create: {
              version: dto.agentVersion,
              status: AgentStatus.CONNECTED,
              lastConnectedAt: new Date(),
              lastIpAddress: ipAddress,
              credentials: {
                create: {
                  keyId,
                  secretEncrypted: this.encryption.encrypt(secret, keyId),
                  status: CredentialStatus.ACTIVE,
                },
              },
            },
          },
        },
        include: { agent: true },
      });

      await tx.registrationToken.update({ where: { id: token.id }, data: { usedByServerId: server.id } });
      await tx.agentConnectionEvent.create({
        data: { agentId: server.agent!.id, type: AgentEventType.REGISTERED, ipAddress, agentVersion: dto.agentVersion },
      });
      await tx.agentConnectionEvent.create({
        data: { agentId: server.agent!.id, type: AgentEventType.CONNECTED, ipAddress, agentVersion: dto.agentVersion },
      });
      return server;
    });

    await this.audit.record({
      userId: token.createdById,
      actorLabel: `agent:${dto.host.hostname}`,
      action: 'agent.register',
      resourceType: 'server',
      resourceId: result.id,
      ipAddress,
      result: AuditResult.SUCCESS,
      metadata: { serverName, osFamily: dto.host.osFamily, osName: dto.host.osName, agentVersion: dto.agentVersion, tokenId: token.id },
    });
    this.logger.log(`Yeni sunucu kaydedildi: ${serverName} (${dto.host.osFamily})`);
    this.realtime.emit('server.registered', { serverId: result.id, name: serverName, osFamily: dto.host.osFamily, tokenId: token.id });

    return {
      agentId: result.agent!.id,
      serverId: result.id,
      serverName,
      keyId,
      secret,
      collectionIntervalSec: result.agent!.collectionIntervalSec,
      heartbeatIntervalSec: HEARTBEAT_INTERVAL_SECONDS,
    };
  }

  async heartbeat(agent: AuthenticatedAgent, dto: HeartbeatDto, ipAddress: string | null): Promise<HeartbeatResult> {
    const now = new Date();
    const current = await this.prisma.agent.findUnique({
      where: { id: agent.agentId },
      include: { server: { select: { id: true, name: true, status: true, osFamily: true } } },
    });
    if (!current) throw AppError.unauthorized('AGENT_AUTH_INVALID');
    if (current.server.osFamily !== dto.host.osFamily) throw AppError.badRequest('REGISTRATION_OS_MISMATCH');

    const reconnecting = current.status !== AgentStatus.CONNECTED;
    const versionChanged = current.version !== dto.agentVersion;

    await this.prisma.$transaction(async (tx) => {
      await tx.agent.update({
        where: { id: agent.agentId },
        data: {
          version: dto.agentVersion,
          status: AgentStatus.CONNECTED,
          lastConnectedAt: reconnecting ? now : undefined,
          lastIpAddress: ipAddress,
        },
      });
      await tx.server.update({
        where: { id: current.serverId },
        data: {
          status: current.server.status === ServerStatus.DEGRADED ? undefined : ServerStatus.ONLINE,
          lastHeartbeatAt: now,
          ...hostInfoToServerData(dto.host),
        },
      });
      await tx.agentCredential.update({ where: { id: agent.credentialId }, data: { lastUsedAt: now } });
      if (reconnecting) {
        await tx.agentConnectionEvent.create({
          data: { agentId: agent.agentId, type: AgentEventType.CONNECTED, ipAddress, agentVersion: dto.agentVersion },
        });
      }
      if (versionChanged && current.version) {
        await tx.agentConnectionEvent.create({
          data: {
            agentId: agent.agentId,
            type: AgentEventType.VERSION_CHANGED,
            ipAddress,
            agentVersion: dto.agentVersion,
            detail: `${current.version} -> ${dto.agentVersion}`,
          },
        });
      }
    });

    if (reconnecting || current.server.status === ServerStatus.OFFLINE || current.server.status === ServerStatus.PENDING) {
      this.realtime.emit('server.status', { serverId: current.serverId, status: ServerStatus.ONLINE, agentStatus: AgentStatus.CONNECTED });
      await this.incidents.resolveAuto(IncidentType.AGENT_DISCONNECTED, { serverId: current.serverId }, 'Ajan yeniden bağlandı', { serverName: current.server.name });
    }

    return {
      serverTime: now.toISOString(),
      collectionIntervalSec: current.collectionIntervalSec,
      heartbeatIntervalSec: HEARTBEAT_INTERVAL_SECONDS,
      serverName: current.server.name,
      commands: await this.services.takePendingCommands(agent.agentId),
    };
  }

  async ingestMetrics(agent: AuthenticatedAgent, dto: MetricsBatchDto): Promise<{ accepted: number; rejected: number }> {
    const now = Date.now();
    const metricRows: Prisma.MetricSampleCreateManyInput[] = [];
    const diskRows: Prisma.DiskSampleCreateManyInput[] = [];
    const netRows: Prisma.NetworkInterfaceSampleCreateManyInput[] = [];
    let rejected = 0;

    for (const sample of dto.samples) {
      const timestamp = new Date(sample.timestamp);
      const age = now - timestamp.getTime();
      if (Number.isNaN(timestamp.getTime()) || age > MAX_SAMPLE_AGE_MS || age < -MAX_SAMPLE_FUTURE_MS) {
        rejected += 1;
        continue;
      }
      const diskRead = sample.disks.reduce((sum, d) => sum + (d.readBytesPerSec ?? 0), 0);
      const diskWrite = sample.disks.reduce((sum, d) => sum + (d.writeBytesPerSec ?? 0), 0);
      const netRx = sample.network.reduce((sum, n) => sum + n.rxBytesPerSec, 0);
      const netTx = sample.network.reduce((sum, n) => sum + n.txBytesPerSec, 0);

      metricRows.push({
        serverId: agent.serverId,
        timestamp,
        cpuPercent: sample.cpu.percent,
        memoryTotalBytes: BigInt(Math.round(sample.memory.totalBytes)),
        memoryUsedBytes: BigInt(Math.round(sample.memory.usedBytes)),
        memoryPercent: sample.memory.percent,
        loadAvg1: sample.loadAverage?.load1,
        loadAvg5: sample.loadAverage?.load5,
        loadAvg15: sample.loadAverage?.load15,
        diskReadBps: diskRead,
        diskWriteBps: diskWrite,
        netRxBps: netRx,
        netTxBps: netTx,
        uptimeSeconds: sample.uptimeSeconds !== undefined ? BigInt(Math.round(sample.uptimeSeconds)) : undefined,
      });
      for (const disk of sample.disks) {
        diskRows.push({
          serverId: agent.serverId,
          timestamp,
          volume: disk.volume,
          totalBytes: BigInt(Math.round(disk.totalBytes)),
          usedBytes: BigInt(Math.round(disk.usedBytes)),
          freeBytes: BigInt(Math.round(disk.freeBytes)),
          readBps: disk.readBytesPerSec,
          writeBps: disk.writeBytesPerSec,
        });
      }
      for (const iface of sample.network) {
        netRows.push({
          serverId: agent.serverId,
          timestamp,
          interfaceName: iface.name,
          rxBps: iface.rxBytesPerSec,
          txBps: iface.txBytesPerSec,
          isUp: iface.isUp ?? true,
        });
      }
    }

    if (metricRows.length > 0) {
      await this.prisma.$transaction([
        this.prisma.metricSample.createMany({ data: metricRows, skipDuplicates: true }),
        this.prisma.diskSample.createMany({ data: diskRows, skipDuplicates: true }),
        this.prisma.networkInterfaceSample.createMany({ data: netRows, skipDuplicates: true }),
        this.prisma.server.update({ where: { id: agent.serverId }, data: { lastHeartbeatAt: new Date() } }),
      ]);
      const latest = metricRows[metricRows.length - 1];
      this.realtime.emit('server.metrics', {
        serverId: agent.serverId,
        timestamp: latest.timestamp,
        cpuPercent: latest.cpuPercent,
        memoryPercent: latest.memoryPercent,
      });
      await this.applyThresholds(agent.serverId);
    }
    return { accepted: metricRows.length, rejected };
  }

  /** Eşik aşımına göre sunucuyu DEGRADED / ONLINE arasında geçirir (yalnızca çevrimiçi sunucular için). */
  private async applyThresholds(serverId: string): Promise<void> {
    const server = await this.prisma.server.findUnique({ where: { id: serverId }, select: { status: true, name: true } });
    if (!server || (server.status !== ServerStatus.ONLINE && server.status !== ServerStatus.DEGRADED)) return;
    const evaluation = await this.metrics.evaluateThresholds(serverId);
    const next = evaluation.degraded ? ServerStatus.DEGRADED : ServerStatus.ONLINE;
    const context = { serverName: server.name };
    if (next !== server.status) {
      await this.prisma.server.update({ where: { id: serverId }, data: { status: next } });
      if (next === ServerStatus.DEGRADED) {
        this.logger.warn(`Sunucu sorunlu: ${server.name} (${evaluation.reasons.join(', ')})`);
      } else {
        this.logger.log(`Sunucu normale döndü: ${server.name}`);
      }
      this.realtime.emit('server.status', { serverId, status: next, reasons: evaluation.reasons });
    }
    // Kaynak olayları: her eşik türü için ayrı olay; aşım sürdükçe tek olay kalır, bitince çözülür.
    const t = evaluation.thresholds;
    if (evaluation.cpu) {
      await this.incidents.open({ type: IncidentType.HIGH_CPU, severity: IncidentSeverity.WARNING, title: `Yüksek CPU kullanımı: ${server.name}`, description: `CPU kullanımı ${t.consecutiveSamples} ardışık örnekte %${t.cpuPercent} eşiğini aştı.`, serverId, context });
    } else {
      await this.incidents.resolveAuto(IncidentType.HIGH_CPU, { serverId }, 'CPU kullanımı eşiğin altına indi', context);
    }
    if (evaluation.memory) {
      await this.incidents.open({ type: IncidentType.HIGH_MEMORY, severity: IncidentSeverity.WARNING, title: `Yüksek bellek kullanımı: ${server.name}`, description: `Bellek kullanımı ${t.consecutiveSamples} ardışık örnekte %${t.memoryPercent} eşiğini aştı.`, serverId, context });
    } else {
      await this.incidents.resolveAuto(IncidentType.HIGH_MEMORY, { serverId }, 'Bellek kullanımı eşiğin altına indi', context);
    }
    if (evaluation.disks.length > 0) {
      await this.incidents.open({ type: IncidentType.LOW_DISK, severity: IncidentSeverity.WARNING, title: `Düşük disk alanı: ${server.name}`, description: `Şu hacimler %${t.diskPercent} doluluk eşiğini aştı: ${evaluation.disks.join(', ')}`, serverId, context });
    } else {
      await this.incidents.resolveAuto(IncidentType.LOW_DISK, { serverId }, 'Disk doluluğu eşiğin altına indi', context);
    }
  }

  /**
   * Heartbeat göndermeyen ajanları ve sunucularını çevrimdışı olarak işaretler. Zamanlayıcı tarafından
   * düzenli aralıklarla çağrılır; her geçiş için bir bağlantı olayı kaydedilir.
   */
  async sweepOfflineAgents(now = new Date()): Promise<number> {
    const threshold = new Date(now.getTime() - OFFLINE_THRESHOLD_SECONDS * 1000);
    const stale = await this.prisma.server.findMany({
      where: {
        status: { in: [ServerStatus.ONLINE, ServerStatus.DEGRADED] },
        agent: { status: AgentStatus.CONNECTED },
        OR: [{ lastHeartbeatAt: { lt: threshold } }, { lastHeartbeatAt: null }],
      },
      include: { agent: { select: { id: true, version: true } } },
    });

    for (const server of stale) {
      if (!server.agent) continue;
      await this.prisma.$transaction([
        this.prisma.server.update({ where: { id: server.id }, data: { status: ServerStatus.OFFLINE } }),
        this.prisma.agent.update({
          where: { id: server.agent.id },
          data: { status: AgentStatus.DISCONNECTED, lastDisconnectedAt: now },
        }),
        this.prisma.agentConnectionEvent.create({
          data: {
            agentId: server.agent.id,
            type: AgentEventType.DISCONNECTED,
            agentVersion: server.agent.version,
            detail: `Son heartbeat: ${server.lastHeartbeatAt?.toISOString() ?? 'hiç'}`,
          },
        }),
      ]);
      this.logger.warn(`Sunucu çevrimdışı: ${server.name}`);
      this.realtime.emit('server.status', { serverId: server.id, status: ServerStatus.OFFLINE, agentStatus: AgentStatus.DISCONNECTED });
      await this.incidents.open({
        type: IncidentType.AGENT_DISCONNECTED,
        severity: IncidentSeverity.CRITICAL,
        title: `Sunucu çevrimdışı: ${server.name}`,
        description: `Ajan ${OFFLINE_THRESHOLD_SECONDS} saniyedir heartbeat göndermiyor. Son heartbeat: ${server.lastHeartbeatAt?.toISOString() ?? 'hiç'}.`,
        serverId: server.id,
        context: { serverName: server.name },
      });
    }
    return stale.length;
  }
}
