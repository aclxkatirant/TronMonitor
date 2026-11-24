import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { AppConfigService } from '../config/config.service';
import { AgentsService } from './agents.service';

export const MAINTENANCE_QUEUE = 'maintenance';
export const JOB_AGENT_STATUS_SWEEP = 'agent-status-sweep';
const SWEEP_EVERY_MS = 30_000;

/**
 * Çevrimdışı ajan taramasını BullMQ ile periyodik olarak çalıştırır. Test ortamında zamanlayıcı başlatılmaz;
 * tarama testlerde doğrudan çağrılır.
 */
@Injectable()
export class AgentStatusScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentStatusScheduler.name);
  private queue?: Queue;
  private worker?: Worker;
  private connection?: Redis;

  constructor(
    private readonly config: AppConfigService,
    private readonly agents: AgentsService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.config.isTest) return;
    // BullMQ engelleyen komutlar kullandığından kendi bağlantısını ve maxRetriesPerRequest=null ister.
    this.connection = new Redis(this.config.get('REDIS_URL'), { maxRetriesPerRequest: null, enableReadyCheck: false });
    this.queue = new Queue(MAINTENANCE_QUEUE, { connection: this.connection });
    await this.queue.upsertJobScheduler(
      JOB_AGENT_STATUS_SWEEP,
      { every: SWEEP_EVERY_MS },
      { name: JOB_AGENT_STATUS_SWEEP, opts: { removeOnComplete: 20, removeOnFail: 50 } },
    );
    this.worker = new Worker(
      MAINTENANCE_QUEUE,
      async (job) => {
        if (job.name === JOB_AGENT_STATUS_SWEEP) {
          const count = await this.agents.sweepOfflineAgents();
          return { markedOffline: count };
        }
        return null;
      },
      { connection: this.connection, concurrency: 1 },
    );
    this.worker.on('failed', (job, error) => {
      this.logger.error(`Bakım işi başarısız (${job?.name ?? '?'}): ${error.message}`);
    });
    this.logger.log(`Ajan durum taraması her ${SWEEP_EVERY_MS / 1000} saniyede bir çalışacak`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    await this.connection?.quit();
  }
}
