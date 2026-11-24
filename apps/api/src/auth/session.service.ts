import { Injectable } from '@nestjs/common';
import type { User, UserSession } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfigService } from '../config/config.service';
import { generateToken, hmacToken } from '../common/crypto';

const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export interface ValidatedSession {
  session: UserSession;
  user: User;
}

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  private hash(token: string): string {
    return hmacToken(token, this.config.get('SESSION_SECRET'));
  }

  async create(userId: string, ipAddress: string | null, userAgent: string | null): Promise<{ token: string; session: UserSession }> {
    const token = generateToken(32);
    const session = await this.prisma.userSession.create({
      data: {
        userId,
        tokenHash: this.hash(token),
        ipAddress,
        userAgent: userAgent?.slice(0, 512) ?? null,
        expiresAt: new Date(Date.now() + this.config.sessionTtlMs),
      },
    });
    return { token, session };
  }

  async validate(token: string): Promise<ValidatedSession | null> {
    if (!token || token.length > 256) return null;
    const session = await this.prisma.userSession.findUnique({
      where: { tokenHash: this.hash(token) },
      include: { user: true },
    });
    if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) return null;
    if (!session.user.isActive) return null;

    if (Date.now() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.prisma.userSession.update({
        where: { id: session.id },
        data: { lastSeenAt: new Date() },
      });
    }
    const { user, ...rest } = session;
    return { session: rest, user };
  }

  async revoke(sessionId: string): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string, exceptSessionId?: string): Promise<number> {
    const result = await this.prisma.userSession.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  async listActive(userId: string): Promise<UserSession[]> {
    return this.prisma.userSession.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
    });
  }

  async findOwned(userId: string, sessionId: string): Promise<UserSession | null> {
    return this.prisma.userSession.findFirst({ where: { id: sessionId, userId, revokedAt: null } });
  }

  /** Süresi dolmuş veya iptal edilmiş eski oturumları temizler. */
  async purgeExpired(olderThanDays = 30): Promise<number> {
    const threshold = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    const result = await this.prisma.userSession.deleteMany({
      where: { OR: [{ expiresAt: { lt: threshold } }, { revokedAt: { lt: threshold } }] },
    });
    return result.count;
  }
}
