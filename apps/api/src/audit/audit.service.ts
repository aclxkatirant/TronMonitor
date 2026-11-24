import { Injectable, Logger } from '@nestjs/common';
import { AuditResult, type Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  userId?: string | null;
  actorLabel: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  ipAddress?: string | null;
  result: AuditResult;
  metadata?: Record<string, unknown>;
}

/**
 * Yalnızca ekleme yapan işlem kaydı servisi. Kayıt yazımı ana işlemi asla başarısız kılmaz.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: entry.userId ?? null,
          actorLabel: entry.actorLabel,
          action: entry.action,
          resourceType: entry.resourceType,
          resourceId: entry.resourceId,
          ipAddress: entry.ipAddress ?? null,
          result: entry.result,
          metadata: (entry.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`İşlem kaydı yazılamadı (${entry.action}): ${message}`);
    }
  }
}
