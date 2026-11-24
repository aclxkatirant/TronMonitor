import { Injectable, OnModuleInit } from '@nestjs/common';
import { MaintenanceService } from '../queue/maintenance.service';
import { AgentsService } from './agents.service';

export const JOB_AGENT_STATUS_SWEEP = 'agent-status-sweep';
const SWEEP_EVERY_MS = 30_000;

/** Çevrimdışı ajan taramasını paylaşılan bakım kuyruğuna kaydeder. */
@Injectable()
export class AgentStatusScheduler implements OnModuleInit {
  constructor(
    private readonly maintenance: MaintenanceService,
    private readonly agents: AgentsService,
  ) {}

  onModuleInit(): void {
    this.maintenance.register(JOB_AGENT_STATUS_SWEEP, SWEEP_EVERY_MS, async () => ({ markedOffline: await this.agents.sweepOfflineAgents() }));
  }
}
