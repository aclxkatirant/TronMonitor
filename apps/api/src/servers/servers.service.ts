import { Injectable, Logger } from '@nestjs/common';
import {
  AgentEventType,
  AgentStatus,
  AuditResult,
  CredentialStatus,
  OsFamily,
  Prisma,
  ServerStatus,
  type Agent,
  type AgentCredential,
  type Server,
  type ServerGroup,
  type Tag,
} from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/app-error';
import { RealtimeService } from '../realtime/realtime.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { ListEventsQueryDto, ListServersQueryDto, UpdateAgentSettingsDto, UpdateServerDto } from './dto/servers.dto';

interface LatestSampleRow {
  serverId: string;
  timestamp: Date;
  cpuPercent: number;
  memoryPercent: number;
  memoryUsedBytes: bigint;
  memoryTotalBytes: bigint;
  uptimeSeconds: bigint | null;
}

interface LatestDiskRow {
  serverId: string;
  volume: string;
  timestamp: Date;
  totalBytes: bigint;
  usedBytes: bigint;
  freeBytes: bigint;
  readBps: number | null;
  writeBps: number | null;
}

interface LatestNetworkRow {
  serverId: string;
  interfaceName: string;
  timestamp: Date;
  rxBps: number;
  txBps: number;
  isUp: boolean;
}

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
  lastHeartbeatAt: Date | null;
  registeredAt: Date;
  group: { id: string; name: string; color: string | null } | null;
  tags: { id: string; name: string; color: string | null }[];
  agent: { status: AgentStatus; version: string | null } | null;
  metrics: ServerMetricsSnapshot | null;
}

export type ServerWithRelations = Server & {
  group: ServerGroup | null;
  tags: { tag: Tag }[];
  agent: (Agent & { credentials: AgentCredential[] }) | null;
};

const SORTABLE: Record<string, Prisma.ServerOrderByWithRelationInput> = {
  name: { name: 'asc' },
  status: { status: 'asc' },
  osFamily: { osFamily: 'asc' },
  lastHeartbeatAt: { lastHeartbeatAt: 'asc' },
  registeredAt: { registeredAt: 'asc' },
};

@Injectable()
export class ServersService {
  private readonly logger = new Logger(ServersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  // ---------------------------------------------------------------------------
  // Listeleme ve ayrıntı
  // ---------------------------------------------------------------------------

  async list(query: ListServersQueryDto): Promise<{ items: ServerListItem[]; total: number; page: number; pageSize: number }> {
    const where: Prisma.ServerWhereInput = {
      ...(query.osFamily ? { osFamily: query.osFamily } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.groupId ? { groupId: query.groupId } : {}),
      ...(query.tagId ? { tags: { some: { tagId: query.tagId } } } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { hostname: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const orderBy = SORTABLE[query.sort] ?? SORTABLE.name;
    const direction = query.order;
    const orderEntry = Object.keys(orderBy)[0];

    const [servers, total] = await Promise.all([
      this.prisma.server.findMany({
        where,
        include: { group: true, tags: { include: { tag: true } }, agent: { select: { status: true, version: true } } },
        orderBy: [{ [orderEntry]: direction }, { name: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.server.count({ where }),
    ]);

    const snapshots = await this.latestSnapshots(servers.map((s) => s.id));
    const items: ServerListItem[] = servers.map((server) => ({
      id: server.id,
      name: server.name,
      description: server.description,
      hostname: server.hostname,
      osFamily: server.osFamily,
      osName: server.osName,
      osVersion: server.osVersion,
      architecture: server.architecture,
      status: server.status,
      lastHeartbeatAt: server.lastHeartbeatAt,
      registeredAt: server.registeredAt,
      group: server.group ? { id: server.group.id, name: server.group.name, color: server.group.color } : null,
      tags: server.tags.map((t) => ({ id: t.tag.id, name: t.tag.name, color: t.tag.color })),
      agent: server.agent ? { status: server.agent.status, version: server.agent.version } : null,
      metrics: snapshots.get(server.id) ?? null,
    }));
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async getById(id: string) {
    const server = await this.prisma.server.findUnique({
      where: { id },
      include: {
        group: true,
        tags: { include: { tag: true } },
        agent: { include: { credentials: { orderBy: { issuedAt: 'desc' }, take: 1 } } },
      },
    });
    if (!server) throw AppError.notFound('SERVER_NOT_FOUND');

    const [snapshots, disks, network] = await Promise.all([
      this.latestSnapshots([id]),
      this.latestDisks([id]),
      this.latestNetwork([id]),
    ]);
    const credential = server.agent?.credentials[0] ?? null;

    return {
      id: server.id,
      name: server.name,
      description: server.description,
      hostname: server.hostname,
      osFamily: server.osFamily,
      osName: server.osName,
      osVersion: server.osVersion,
      osEdition: server.osEdition,
      kernelVersion: server.kernelVersion,
      architecture: server.architecture,
      cpuModel: server.cpuModel,
      cpuCores: server.cpuCores,
      totalMemoryBytes: server.totalMemoryBytes?.toString() ?? null,
      status: server.status,
      lastHeartbeatAt: server.lastHeartbeatAt,
      bootTime: server.bootTime,
      registeredAt: server.registeredAt,
      createdAt: server.createdAt,
      updatedAt: server.updatedAt,
      group: server.group ? { id: server.group.id, name: server.group.name, color: server.group.color } : null,
      tags: server.tags.map((t) => ({ id: t.tag.id, name: t.tag.name, color: t.tag.color })),
      agent: server.agent
        ? {
            id: server.agent.id,
            status: server.agent.status,
            version: server.agent.version,
            lastConnectedAt: server.agent.lastConnectedAt,
            lastDisconnectedAt: server.agent.lastDisconnectedAt,
            lastIpAddress: server.agent.lastIpAddress,
            collectionIntervalSec: server.agent.collectionIntervalSec,
            credential: credential
              ? { keyId: credential.keyId, status: credential.status, issuedAt: credential.issuedAt, lastUsedAt: credential.lastUsedAt, revokedAt: credential.revokedAt }
              : null,
          }
        : null,
      metrics: snapshots.get(id) ?? null,
      disks: disks.map((d) => ({
        volume: d.volume,
        timestamp: d.timestamp,
        totalBytes: d.totalBytes.toString(),
        usedBytes: d.usedBytes.toString(),
        freeBytes: d.freeBytes.toString(),
        usedPercent: d.totalBytes > 0n ? Number((d.usedBytes * 10000n) / d.totalBytes) / 100 : 0,
        readBps: d.readBps,
        writeBps: d.writeBps,
      })),
      network: network.map((n) => ({ name: n.interfaceName, timestamp: n.timestamp, rxBps: n.rxBps, txBps: n.txBps, isUp: n.isUp })),
    };
  }

  async listEvents(serverId: string, query: ListEventsQueryDto) {
    const agent = await this.prisma.agent.findUnique({ where: { serverId }, select: { id: true } });
    if (!agent) {
      const exists = await this.prisma.server.count({ where: { id: serverId } });
      if (!exists) throw AppError.notFound('SERVER_NOT_FOUND');
      return { items: [], total: 0, page: query.page, pageSize: query.pageSize };
    }
    const [items, total] = await Promise.all([
      this.prisma.agentConnectionEvent.findMany({
        where: { agentId: agent.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.agentConnectionEvent.count({ where: { agentId: agent.id } }),
    ]);
    return {
      items: items.map((e) => ({ id: e.id.toString(), type: e.type, ipAddress: e.ipAddress, agentVersion: e.agentVersion, detail: e.detail, createdAt: e.createdAt })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  // ---------------------------------------------------------------------------
  // Düzenleme ve silme
  // ---------------------------------------------------------------------------

  async update(actor: AuthenticatedUser, id: string, dto: UpdateServerDto, ipAddress: string | null) {
    const existing = await this.prisma.server.findUnique({ where: { id }, include: { tags: true } });
    if (!existing) throw AppError.notFound('SERVER_NOT_FOUND');
    if (dto.groupId) {
      const group = await this.prisma.serverGroup.findUnique({ where: { id: dto.groupId } });
      if (!group) throw AppError.notFound('SERVER_GROUP_NOT_FOUND');
    }
    if (dto.tagIds) {
      const count = await this.prisma.tag.count({ where: { id: { in: dto.tagIds } } });
      if (count !== new Set(dto.tagIds).size) throw AppError.notFound('TAG_NOT_FOUND');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.server.update({
        where: { id },
        data: {
          name: dto.name,
          description: dto.description,
          groupId: dto.groupId === undefined ? undefined : dto.groupId,
        },
      });
      if (dto.tagIds) {
        await tx.serverTag.deleteMany({ where: { serverId: id } });
        if (dto.tagIds.length > 0) {
          await tx.serverTag.createMany({ data: [...new Set(dto.tagIds)].map((tagId) => ({ serverId: id, tagId })), skipDuplicates: true });
        }
      }
    });

    await this.audit.record({
      userId: actor.id,
      actorLabel: actor.email,
      action: 'server.update',
      resourceType: 'server',
      resourceId: id,
      ipAddress,
      result: AuditResult.SUCCESS,
      metadata: { changes: { name: dto.name, description: dto.description, groupId: dto.groupId, tagIds: dto.tagIds } },
    });
    this.realtime.emit('server.updated', { serverId: id });
    return this.getById(id);
  }

  async remove(actor: AuthenticatedUser, id: string, ipAddress: string | null): Promise<void> {
    const server = await this.prisma.server.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!server) throw AppError.notFound('SERVER_NOT_FOUND');
    await this.prisma.server.delete({ where: { id } });
    await this.audit.record({
      userId: actor.id,
      actorLabel: actor.email,
      action: 'server.delete',
      resourceType: 'server',
      resourceId: id,
      ipAddress,
      result: AuditResult.SUCCESS,
      metadata: { name: server.name },
    });
    this.realtime.emit('server.deleted', { serverId: id, name: server.name });
    this.logger.log(`Sunucu silindi: ${server.name}`);
  }

  // ---------------------------------------------------------------------------
  // Ajan yönetimi
  // ---------------------------------------------------------------------------

  async revokeAgent(actor: AuthenticatedUser, serverId: string, ipAddress: string | null) {
    const server = await this.prisma.server.findUnique({ where: { id: serverId }, include: { agent: { include: { credentials: true } } } });
    if (!server) throw AppError.notFound('SERVER_NOT_FOUND');
    if (!server.agent) throw AppError.notFound('AGENT_NOT_FOUND');
    const active = server.agent.credentials.filter((c) => c.status === CredentialStatus.ACTIVE);
    if (active.length === 0) throw AppError.conflict('AGENT_ALREADY_REVOKED');

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.agentCredential.updateMany({ where: { agentId: server.agent.id, status: CredentialStatus.ACTIVE }, data: { status: CredentialStatus.REVOKED, revokedAt: now } }),
      this.prisma.agent.update({ where: { id: server.agent.id }, data: { status: AgentStatus.REVOKED, lastDisconnectedAt: now } }),
      this.prisma.server.update({ where: { id: serverId }, data: { status: ServerStatus.OFFLINE } }),
      this.prisma.agentConnectionEvent.create({ data: { agentId: server.agent.id, type: AgentEventType.CREDENTIAL_REVOKED, ipAddress, detail: `İptal eden: ${actor.email}` } }),
    ]);
    await this.audit.record({
      userId: actor.id,
      actorLabel: actor.email,
      action: 'agent.revoke',
      resourceType: 'server',
      resourceId: serverId,
      ipAddress,
      result: AuditResult.SUCCESS,
      metadata: { revokedCredentials: active.map((c) => c.keyId) },
    });
    this.realtime.emit('agent.revoked', { serverId });
    this.realtime.emit('server.status', { serverId, status: ServerStatus.OFFLINE });
    return this.getById(serverId);
  }

  async updateAgentSettings(actor: AuthenticatedUser, serverId: string, dto: UpdateAgentSettingsDto, ipAddress: string | null) {
    const agent = await this.prisma.agent.findUnique({ where: { serverId } });
    if (!agent) throw AppError.notFound('AGENT_NOT_FOUND');
    await this.prisma.agent.update({ where: { id: agent.id }, data: { collectionIntervalSec: dto.collectionIntervalSec } });
    await this.audit.record({
      userId: actor.id,
      actorLabel: actor.email,
      action: 'agent.settings',
      resourceType: 'server',
      resourceId: serverId,
      ipAddress,
      result: AuditResult.SUCCESS,
      metadata: { collectionIntervalSec: dto.collectionIntervalSec },
    });
    this.realtime.emit('server.updated', { serverId });
    return this.getById(serverId);
  }

  // ---------------------------------------------------------------------------
  // Son metrik anlık görüntüleri (DISTINCT ON ile sunucu başına en son örnek)
  // ---------------------------------------------------------------------------

  async latestSnapshots(serverIds: string[]): Promise<Map<string, ServerMetricsSnapshot>> {
    const result = new Map<string, ServerMetricsSnapshot>();
    if (serverIds.length === 0) return result;

    const [samples, disks] = await Promise.all([
      this.prisma.$queryRaw<LatestSampleRow[]>`
        SELECT DISTINCT ON ("serverId") "serverId", "timestamp", "cpuPercent", "memoryPercent", "memoryUsedBytes", "memoryTotalBytes", "uptimeSeconds"
        FROM "MetricSample"
        WHERE "serverId" IN (${Prisma.join(serverIds)})
        ORDER BY "serverId", "timestamp" DESC`,
      this.latestDisks(serverIds),
    ]);

    const diskTotals = new Map<string, { total: bigint; used: bigint }>();
    for (const disk of disks) {
      const entry = diskTotals.get(disk.serverId) ?? { total: 0n, used: 0n };
      entry.total += disk.totalBytes;
      entry.used += disk.usedBytes;
      diskTotals.set(disk.serverId, entry);
    }

    for (const row of samples) {
      const disk = diskTotals.get(row.serverId);
      result.set(row.serverId, {
        timestamp: row.timestamp.toISOString(),
        cpuPercent: row.cpuPercent,
        memoryPercent: row.memoryPercent,
        memoryUsedBytes: row.memoryUsedBytes.toString(),
        memoryTotalBytes: row.memoryTotalBytes.toString(),
        uptimeSeconds: row.uptimeSeconds === null ? null : Number(row.uptimeSeconds),
        diskUsedPercent: disk && disk.total > 0n ? Number((disk.used * 10000n) / disk.total) / 100 : null,
        diskTotalBytes: (disk?.total ?? 0n).toString(),
        diskUsedBytes: (disk?.used ?? 0n).toString(),
      });
    }
    return result;
  }

  async latestDisks(serverIds: string[]): Promise<LatestDiskRow[]> {
    if (serverIds.length === 0) return [];
    // Yalnızca son 1 saat içindeki örnekler dikkate alınır; kaldırılan hacimler listede kalmaz.
    // Zaman damgaları UTC olarak saklanır; sınır da JS tarafında UTC üretilir (NOW() oturum saat dilimine bağlıdır).
    const since = new Date(Date.now() - 60 * 60 * 1000);
    return this.prisma.$queryRaw<LatestDiskRow[]>`
      SELECT DISTINCT ON ("serverId", "volume") "serverId", "volume", "timestamp", "totalBytes", "usedBytes", "freeBytes", "readBps", "writeBps"
      FROM "DiskSample"
      WHERE "serverId" IN (${Prisma.join(serverIds)}) AND "timestamp" > ${since}
      ORDER BY "serverId", "volume", "timestamp" DESC`;
  }

  async latestNetwork(serverIds: string[]): Promise<LatestNetworkRow[]> {
    if (serverIds.length === 0) return [];
    const since = new Date(Date.now() - 60 * 60 * 1000);
    return this.prisma.$queryRaw<LatestNetworkRow[]>`
      SELECT DISTINCT ON ("serverId", "interfaceName") "serverId", "interfaceName", "timestamp", "rxBps", "txBps", "isUp"
      FROM "NetworkInterfaceSample"
      WHERE "serverId" IN (${Prisma.join(serverIds)}) AND "timestamp" > ${since}
      ORDER BY "serverId", "interfaceName", "timestamp" DESC`;
  }
}
