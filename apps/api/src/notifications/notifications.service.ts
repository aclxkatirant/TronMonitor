import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { z } from 'zod';
import { AuditResult, IncidentType, NotificationChannelType, NotificationStatus, type Incident, type NotificationChannel, type Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppConfigService } from '../config/config.service';
import { EncryptionService } from '../common/encryption.service';
import { AppError } from '../common/app-error';
import type { AuthenticatedUser } from '../auth/auth.types';
import { NOTIFICATION_EVENTS, eventForIncident, recoveryEventForIncident, type NotificationEvent } from './notification-events';
import { maskConfig, sendViaProvider, type ChannelConfig, type NotificationMessage } from './providers';
import type { CreateChannelDto, UpdateChannelDto } from './dto/notifications.dto';

export const NOTIFICATIONS_QUEUE = 'notifications';
const MAX_ATTEMPTS = 5;

const discordSchema = z.object({
  webhookUrl: z.string().url('Webhook adresi geçersiz.').refine((u) => /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(u), 'Discord webhook adresi https://discord.com/api/webhooks/ ile başlamalıdır.'),
  username: z.string().max(80).optional().or(z.literal('')),
});
const telegramSchema = z.object({
  botToken: z.string().regex(/^\d+:[A-Za-z0-9_-]{20,}$/, 'Telegram bot belirteci geçersiz.'),
  chatId: z.string().min(1, 'Sohbet kimliği gereklidir.').max(64),
});
const emailSchema = z.object({
  host: z.string().min(1, 'SMTP sunucusu gereklidir.').max(255),
  port: z.coerce.number().int().min(1).max(65535),
  secure: z.boolean().default(false),
  username: z.string().max(255).optional().or(z.literal('')),
  password: z.string().max(255).optional().or(z.literal('')),
  from: z.string().email('Gönderen adresi geçersiz.'),
  to: z.array(z.string().email('Alıcı adresi geçersiz.')).min(1, 'En az bir alıcı gereklidir.').max(20),
});

const SECRET_FIELDS: Record<NotificationChannelType, string[]> = {
  DISCORD: ['webhookUrl'],
  TELEGRAM: ['botToken'],
  EMAIL: ['password'],
};

interface IncidentPayload {
  incident: Incident;
  context: Record<string, unknown>;
}

@Injectable()
export class NotificationsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsService.name);
  private queue?: Queue;
  private worker?: Worker;
  private connection?: Redis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
    private readonly encryption: EncryptionService,
  ) {}

  // ---------------------------------------------------------------------------
  // Kuyruk
  // ---------------------------------------------------------------------------

  onApplicationBootstrap(): void {
    if (this.config.isTest) return;
    this.connection = new Redis(this.config.get('REDIS_URL'), { maxRetriesPerRequest: null, enableReadyCheck: false });
    this.queue = new Queue(NOTIFICATIONS_QUEUE, { connection: this.connection });
    this.worker = new Worker(
      NOTIFICATIONS_QUEUE,
      async (job) => {
        const { notificationId } = job.data as { notificationId: string };
        await this.deliver(notificationId);
      },
      { connection: this.connection, concurrency: 3 },
    );
    this.worker.on('failed', (job, error) => this.logger.warn(`Bildirim gönderimi başarısız (${job?.id ?? '?'}, deneme ${job?.attemptsMade ?? '?'}): ${error.message}`));
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    await this.connection?.quit();
  }

  // ---------------------------------------------------------------------------
  // Kanal yönetimi
  // ---------------------------------------------------------------------------

  private validateConfig(type: NotificationChannelType, raw: Record<string, unknown>): ChannelConfig {
    const schema = type === NotificationChannelType.DISCORD ? discordSchema : type === NotificationChannelType.TELEGRAM ? telegramSchema : emailSchema;
    const result = schema.safeParse(raw);
    if (!result.success) {
      throw AppError.badRequest('VALIDATION_FAILED', result.error.issues.map((i) => i.message));
    }
    return result.data;
  }

  private decryptConfig(channel: NotificationChannel): ChannelConfig {
    return JSON.parse(this.encryption.decrypt(channel.encryptedConfig, channel.type)) as ChannelConfig;
  }

  private encryptConfig(type: NotificationChannelType, config: ChannelConfig): string {
    return this.encryption.encrypt(JSON.stringify(config), type);
  }

  private toView(channel: NotificationChannel, config?: ChannelConfig) {
    return {
      id: channel.id,
      name: channel.name,
      type: channel.type,
      config: config ? maskConfig(channel.type, config) : undefined,
      enabledEvents: channel.enabledEvents,
      isEnabled: channel.isEnabled,
      lastTestedAt: channel.lastTestedAt,
      lastTestResult: channel.lastTestResult,
      createdAt: channel.createdAt,
      updatedAt: channel.updatedAt,
    };
  }

  catalog() {
    return {
      events: Object.entries(NOTIFICATION_EVENTS).map(([key, label]) => ({ key, label })),
      types: [
        { value: NotificationChannelType.DISCORD, label: 'Discord (webhook)' },
        { value: NotificationChannelType.TELEGRAM, label: 'Telegram (bot)' },
        { value: NotificationChannelType.EMAIL, label: 'E-posta (SMTP)' },
      ],
    };
  }

  async listChannels() {
    const channels = await this.prisma.notificationChannel.findMany({ orderBy: { name: 'asc' } });
    return channels.map((c) => {
      let config: ChannelConfig | undefined;
      try {
        config = this.decryptConfig(c);
      } catch {
        config = undefined;
      }
      return this.toView(c, config);
    });
  }

  async createChannel(actor: AuthenticatedUser, dto: CreateChannelDto, ipAddress: string | null) {
    const config = this.validateConfig(dto.type, dto.config);
    const channel = await this.prisma.notificationChannel.create({
      data: {
        name: dto.name,
        type: dto.type,
        encryptedConfig: this.encryptConfig(dto.type, config),
        enabledEvents: [...new Set(dto.enabledEvents)],
        isEnabled: dto.isEnabled ?? true,
      },
    });
    await this.audit.record({ userId: actor.id, actorLabel: actor.email, action: 'notification_channel.create', resourceType: 'notification_channel', resourceId: channel.id, ipAddress, result: AuditResult.SUCCESS, metadata: { name: channel.name, type: channel.type, enabledEvents: channel.enabledEvents } });
    return this.toView(channel, config);
  }

  async updateChannel(actor: AuthenticatedUser, id: string, dto: UpdateChannelDto, ipAddress: string | null) {
    const channel = await this.prisma.notificationChannel.findUnique({ where: { id } });
    if (!channel) throw AppError.notFound('NOTIFICATION_CHANNEL_NOT_FOUND');
    let config = this.decryptConfig(channel);
    if (dto.config) {
      // Boş bırakılan sır alanları mevcut değerle korunur.
      const merged: Record<string, unknown> = { ...(config as unknown as Record<string, unknown>), ...dto.config };
      for (const field of SECRET_FIELDS[channel.type]) {
        if (dto.config[field] === '' || dto.config[field] === undefined) merged[field] = (config as unknown as Record<string, unknown>)[field];
      }
      config = this.validateConfig(channel.type, merged);
    }
    const updated = await this.prisma.notificationChannel.update({
      where: { id },
      data: {
        name: dto.name,
        encryptedConfig: dto.config ? this.encryptConfig(channel.type, config) : undefined,
        enabledEvents: dto.enabledEvents ? [...new Set(dto.enabledEvents)] : undefined,
        isEnabled: dto.isEnabled,
      },
    });
    await this.audit.record({ userId: actor.id, actorLabel: actor.email, action: 'notification_channel.update', resourceType: 'notification_channel', resourceId: id, ipAddress, result: AuditResult.SUCCESS, metadata: { name: dto.name, enabledEvents: dto.enabledEvents, isEnabled: dto.isEnabled, configChanged: !!dto.config } });
    return this.toView(updated, config);
  }

  async deleteChannel(actor: AuthenticatedUser, id: string, ipAddress: string | null): Promise<void> {
    const channel = await this.prisma.notificationChannel.findUnique({ where: { id } });
    if (!channel) throw AppError.notFound('NOTIFICATION_CHANNEL_NOT_FOUND');
    await this.prisma.notificationChannel.delete({ where: { id } });
    await this.audit.record({ userId: actor.id, actorLabel: actor.email, action: 'notification_channel.delete', resourceType: 'notification_channel', resourceId: id, ipAddress, result: AuditResult.SUCCESS, metadata: { name: channel.name } });
  }

  /** Kanala test mesajı gönderir; sonucu kanala kaydeder. */
  async testChannel(actor: AuthenticatedUser, id: string, ipAddress: string | null): Promise<{ ok: boolean; error?: string }> {
    const channel = await this.prisma.notificationChannel.findUnique({ where: { id } });
    if (!channel) throw AppError.notFound('NOTIFICATION_CHANNEL_NOT_FOUND');
    const message: NotificationMessage = {
      title: 'TronMonitor test bildirimi',
      body: `"${channel.name}" kanalı doğru yapılandırılmış. Bu mesaj ${actor.fullName} tarafından gönderildi.`,
      severity: 'INFO',
      fields: [{ label: 'Kanal türü', value: channel.type }],
      link: this.config.get('WEB_ORIGIN'),
      at: new Date(),
    };
    let ok = true;
    let error: string | undefined;
    try {
      await sendViaProvider(channel.type, this.decryptConfig(channel), message);
    } catch (e) {
      ok = false;
      error = e instanceof Error ? e.message : String(e);
    }
    await this.prisma.notificationChannel.update({ where: { id }, data: { lastTestedAt: new Date(), lastTestResult: ok ? 'Başarılı' : `Hata: ${error}`.slice(0, 500) } });
    await this.audit.record({ userId: actor.id, actorLabel: actor.email, action: 'notification_channel.test', resourceType: 'notification_channel', resourceId: id, ipAddress, result: ok ? AuditResult.SUCCESS : AuditResult.FAILURE, metadata: { error } });
    return { ok, error };
  }

  // ---------------------------------------------------------------------------
  // Gönderim
  // ---------------------------------------------------------------------------

  async dispatch(type: IncidentType, payload: IncidentPayload): Promise<number> {
    return this.enqueueForEvent(eventForIncident(type), payload, false);
  }

  async dispatchRecovery(type: IncidentType, payload: IncidentPayload): Promise<number> {
    return this.enqueueForEvent(recoveryEventForIncident(type), payload, true);
  }

  private async enqueueForEvent(event: NotificationEvent, payload: IncidentPayload, recovery: boolean): Promise<number> {
    const channels = await this.prisma.notificationChannel.findMany({ where: { isEnabled: true, enabledEvents: { has: event } } });
    if (channels.length === 0) return 0;
    const message = this.buildMessage(event, payload, recovery);
    let count = 0;
    for (const channel of channels) {
      const notification = await this.prisma.notification.create({
        data: { channelId: channel.id, incidentId: payload.incident.id, eventType: event, payload: message as unknown as Prisma.InputJsonValue, status: NotificationStatus.PENDING },
      });
      count += 1;
      if (this.queue) {
        await this.queue.add('send', { notificationId: notification.id }, { attempts: MAX_ATTEMPTS, backoff: { type: 'exponential', delay: 5_000 }, removeOnComplete: 100, removeOnFail: 200 });
      }
    }
    return count;
  }

  private buildMessage(event: NotificationEvent, payload: IncidentPayload, recovery: boolean): NotificationMessage {
    const { incident, context } = payload;
    const fields: NotificationMessage['fields'] = [];
    if (typeof context.serverName === 'string') fields.push({ label: 'Sunucu', value: context.serverName });
    if (typeof context.checkName === 'string') fields.push({ label: 'Kontrol', value: context.checkName });
    if (typeof context.target === 'string') fields.push({ label: 'Hedef', value: context.target });
    fields.push({ label: 'Başlangıç', value: incident.startedAt.toISOString() });
    if (recovery && incident.resolvedAt) {
      const seconds = Math.round((incident.resolvedAt.getTime() - incident.startedAt.getTime()) / 1000);
      fields.push({ label: 'Süre', value: seconds >= 3600 ? `${Math.floor(seconds / 3600)} sa ${Math.floor((seconds % 3600) / 60)} dk` : `${Math.floor(seconds / 60)} dk ${seconds % 60} sn` });
    }
    return {
      title: recovery ? `Çözüldü: ${incident.title}` : incident.title,
      body: recovery ? (incident.resolutionNote ?? 'Olay çözüldü.') : (incident.description ?? NOTIFICATION_EVENTS[event]),
      severity: recovery ? 'INFO' : incident.severity,
      fields,
      link: `${this.config.get('WEB_ORIGIN')}/olaylar/${incident.id}`,
      at: new Date(),
    };
  }

  /** Tek bir bildirimi gönderir. Kuyruk worker'ı ve testler tarafından çağrılır; hata fırlatırsa yeniden denenir. */
  async deliver(notificationId: string): Promise<void> {
    const notification = await this.prisma.notification.findUnique({ where: { id: notificationId }, include: { channel: true } });
    if (!notification || notification.status === NotificationStatus.SENT) return;
    const message = notification.payload as unknown as NotificationMessage;
    message.at = new Date(message.at);
    try {
      await sendViaProvider(notification.channel.type, this.decryptConfig(notification.channel), message);
      await this.prisma.notification.update({ where: { id: notificationId }, data: { status: NotificationStatus.SENT, sentAt: new Date(), attempts: { increment: 1 }, lastError: null } });
      if (notification.incidentId) {
        await this.prisma.incidentEvent.create({ data: { incidentId: notification.incidentId, kind: 'NOTIFIED', message: `Bildirim gönderildi: ${notification.channel.name}` } });
      }
    } catch (error) {
      const text = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      const attempts = notification.attempts + 1;
      await this.prisma.notification.update({
        where: { id: notificationId },
        data: { attempts, lastError: text, status: attempts >= MAX_ATTEMPTS ? NotificationStatus.FAILED : NotificationStatus.PENDING },
      });
      throw error;
    }
  }

  /** Test ortamı ve elle tetikleme için: bekleyen bildirimleri sırayla gönderir. */
  async deliverPending(limit = 50): Promise<{ sent: number; failed: number }> {
    const pending = await this.prisma.notification.findMany({ where: { status: NotificationStatus.PENDING }, orderBy: { createdAt: 'asc' }, take: limit });
    let sent = 0;
    let failed = 0;
    for (const n of pending) {
      try {
        await this.deliver(n.id);
        sent += 1;
      } catch {
        failed += 1;
      }
    }
    return { sent, failed };
  }

  async recentNotifications(limit = 50) {
    const rows = await this.prisma.notification.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { channel: { select: { name: true, type: true } }, incident: { select: { id: true, title: true } } },
    });
    return rows.map((n) => ({ id: n.id, channelName: n.channel.name, channelType: n.channel.type, eventType: n.eventType, eventLabel: NOTIFICATION_EVENTS[n.eventType as NotificationEvent] ?? n.eventType, incident: n.incident, status: n.status, attempts: n.attempts, lastError: n.lastError, sentAt: n.sentAt, createdAt: n.createdAt }));
  }
}
