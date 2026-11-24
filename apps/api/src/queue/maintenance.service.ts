import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { AppConfigService } from '../config/config.service';

export const MAINTENANCE_QUEUE = 'maintenance';

export type MaintenanceHandler = () => Promise<Record<string, unknown> | void>;

interface Registration {
  everyMs: number;
  handler: MaintenanceHandler;
}

/**
 * Paylaşılan BullMQ bakım kuyruğu. Modüller açılışta işlerini kaydeder; işler tek bir worker tarafından
 * sırayla çalıştırılır. Test ortamında zamanlayıcı başlatılmaz; işler `run(name)` ile doğrudan çağrılır.
 */
@Injectable()
export class MaintenanceService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MaintenanceService.name);
  private readonly registrations = new Map<string, Registration>();
  private queue?: Queue;
  private worker?: Worker;
  private connection?: Redis;

  constructor(private readonly config: AppConfigService) {}

  /** Bir bakım işini kaydeder. Uygulama açılışından önce çağrılmalıdır (modül onModuleInit içinde). */
  register(name: string, everyMs: number, handler: MaintenanceHandler): void {
    if (this.registrations.has(name)) throw new Error(`Bakım işi zaten kayıtlı: ${name}`);
    this.registrations.set(name, { everyMs, handler });
  }

  /** İşi hemen çalıştırır (testler ve elle tetikleme için). */
  async run(name: string): Promise<Record<string, unknown> | void> {
    const registration = this.registrations.get(name);
    if (!registration) throw new Error(`Bakım işi bulunamadı: ${name}`);
    return registration.handler();
  }

  get jobNames(): string[] {
    return [...this.registrations.keys()];
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.isTest || this.registrations.size === 0) return;
    // BullMQ engelleyen komutlar kullandığından kendi bağlantısını ve maxRetriesPerRequest=null ister.
    this.connection = new Redis(this.config.redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: false });
    this.queue = new Queue(MAINTENANCE_QUEUE, { connection: this.connection });
    for (const [name, registration] of this.registrations) {
      await this.queue.upsertJobScheduler(name, { every: registration.everyMs }, { name, opts: { removeOnComplete: 20, removeOnFail: 50 } });
    }
    this.worker = new Worker(
      MAINTENANCE_QUEUE,
      async (job) => {
        const registration = this.registrations.get(job.name);
        if (!registration) return null;
        return (await registration.handler()) ?? null;
      },
      { connection: this.connection, concurrency: 1 },
    );
    this.worker.on('failed', (job, error) => {
      this.logger.error(`Bakım işi başarısız (${job?.name ?? '?'}): ${error.message}`);
    });
    this.logger.log(`Bakım işleri zamanlandı: ${[...this.registrations].map(([n, r]) => `${n} (${r.everyMs / 1000} sn)`).join(', ')}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    await this.connection?.quit();
  }
}
