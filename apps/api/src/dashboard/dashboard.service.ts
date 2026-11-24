import { Injectable } from '@nestjs/common';
import { IncidentStatus, OsFamily, ServerStatus } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ServersService } from '../servers/servers.service';

export interface DashboardSummary {
  servers: {
    total: number;
    online: number;
    offline: number;
    degraded: number;
    pending: number;
    windows: number;
    linux: number;
  };
  availabilityPercent: number | null;
  activeIncidents: number;
  usage: {
    avgCpuPercent: number | null;
    avgMemoryPercent: number | null;
    diskUsedPercent: number | null;
    diskTotalBytes: string;
    diskUsedBytes: string;
    sampledServers: number;
  };
  recentEvents: {
    id: string;
    type: string;
    serverId: string;
    serverName: string;
    detail: string | null;
    agentVersion: string | null;
    createdAt: Date;
  }[];
  generatedAt: string;
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly servers: ServersService,
  ) {}

  async summary(): Promise<DashboardSummary> {
    const [byStatus, byOs, activeIncidents, onlineServers, events] = await Promise.all([
      this.prisma.server.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.server.groupBy({ by: ['osFamily'], _count: { _all: true } }),
      this.prisma.incident.count({ where: { status: { not: IncidentStatus.RESOLVED } } }),
      this.prisma.server.findMany({ where: { status: { in: [ServerStatus.ONLINE, ServerStatus.DEGRADED] } }, select: { id: true } }),
      this.prisma.agentConnectionEvent.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { agent: { select: { serverId: true, server: { select: { name: true } } } } },
      }),
    ]);

    const statusCount = (status: ServerStatus) => byStatus.find((row) => row.status === status)?._count._all ?? 0;
    const osCount = (os: OsFamily) => byOs.find((row) => row.osFamily === os)?._count._all ?? 0;
    const total = byStatus.reduce((sum, row) => sum + row._count._all, 0);
    const online = statusCount(ServerStatus.ONLINE);
    const degraded = statusCount(ServerStatus.DEGRADED);
    const pending = statusCount(ServerStatus.PENDING);
    const registered = total - pending;

    const snapshots = await this.servers.latestSnapshots(onlineServers.map((s) => s.id));
    let cpuSum = 0;
    let memSum = 0;
    let diskTotal = 0n;
    let diskUsed = 0n;
    let sampled = 0;
    for (const snapshot of snapshots.values()) {
      sampled += 1;
      cpuSum += snapshot.cpuPercent;
      memSum += snapshot.memoryPercent;
      diskTotal += BigInt(snapshot.diskTotalBytes);
      diskUsed += BigInt(snapshot.diskUsedBytes);
    }

    return {
      servers: {
        total,
        online,
        offline: statusCount(ServerStatus.OFFLINE),
        degraded,
        pending,
        windows: osCount(OsFamily.WINDOWS),
        linux: osCount(OsFamily.LINUX),
      },
      availabilityPercent: registered > 0 ? Math.round(((online + degraded) / registered) * 1000) / 10 : null,
      activeIncidents,
      usage: {
        avgCpuPercent: sampled > 0 ? Math.round((cpuSum / sampled) * 10) / 10 : null,
        avgMemoryPercent: sampled > 0 ? Math.round((memSum / sampled) * 10) / 10 : null,
        diskUsedPercent: diskTotal > 0n ? Number((diskUsed * 10000n) / diskTotal) / 100 : null,
        diskTotalBytes: diskTotal.toString(),
        diskUsedBytes: diskUsed.toString(),
        sampledServers: sampled,
      },
      recentEvents: events.map((e) => ({
        id: e.id.toString(),
        type: e.type,
        serverId: e.agent.serverId,
        serverName: e.agent.server.name,
        detail: e.detail,
        agentVersion: e.agentVersion,
        createdAt: e.createdAt,
      })),
      generatedAt: new Date().toISOString(),
    };
  }
}
