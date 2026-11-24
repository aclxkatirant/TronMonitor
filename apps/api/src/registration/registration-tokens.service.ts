import { Injectable } from '@nestjs/common';
import { AuditResult, OsFamily, type RegistrationToken } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/app-error';
import { generateToken, sha256 } from '../common/crypto';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CreateRegistrationTokenDto, SUPPORTED_OS_VERSIONS } from './dto/registration-token.dto';

export const REGISTRATION_TOKEN_PREFIX = 'tmr_';
const DEFAULT_TTL_MINUTES = 60;

export interface RegistrationTokenView {
  id: string;
  tokenPrefix: string;
  osFamily: OsFamily;
  osVersion: string | null;
  architecture: string | null;
  serverName: string | null;
  groupId: string | null;
  createdById: string;
  createdByEmail?: string;
  expiresAt: Date;
  usedAt: Date | null;
  usedByServerId: string | null;
  revokedAt: Date | null;
  createdAt: Date;
  status: 'ACTIVE' | 'USED' | 'EXPIRED' | 'REVOKED';
}

export function tokenStatus(token: RegistrationToken, now = new Date()): RegistrationTokenView['status'] {
  if (token.revokedAt) return 'REVOKED';
  if (token.usedAt) return 'USED';
  if (token.expiresAt.getTime() <= now.getTime()) return 'EXPIRED';
  return 'ACTIVE';
}

@Injectable()
export class RegistrationTokensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private toView(token: RegistrationToken & { createdBy?: { email: string } }): RegistrationTokenView {
    return {
      id: token.id,
      tokenPrefix: token.tokenPrefix,
      osFamily: token.osFamily,
      osVersion: token.osVersion,
      architecture: token.architecture,
      serverName: token.serverName,
      groupId: token.groupId,
      createdById: token.createdById,
      createdByEmail: token.createdBy?.email,
      expiresAt: token.expiresAt,
      usedAt: token.usedAt,
      usedByServerId: token.usedByServerId,
      revokedAt: token.revokedAt,
      createdAt: token.createdAt,
      status: tokenStatus(token),
    };
  }

  async create(actor: AuthenticatedUser, dto: CreateRegistrationTokenDto, ipAddress: string | null): Promise<{ token: string; record: RegistrationTokenView }> {
    if (dto.osVersion && !SUPPORTED_OS_VERSIONS[dto.osFamily].includes(dto.osVersion)) {
      throw AppError.badRequest('VALIDATION_FAILED', ['Seçilen işletim sistemi sürümü desteklenmiyor.']);
    }
    if (dto.groupId) {
      const group = await this.prisma.serverGroup.findUnique({ where: { id: dto.groupId } });
      if (!group) throw AppError.notFound('SERVER_GROUP_NOT_FOUND');
    }

    const plaintext = `${REGISTRATION_TOKEN_PREFIX}${generateToken(32)}`;
    const record = await this.prisma.registrationToken.create({
      data: {
        tokenPrefix: plaintext.slice(0, 12),
        tokenHash: sha256(plaintext),
        osFamily: dto.osFamily,
        osVersion: dto.osVersion,
        architecture: dto.architecture,
        serverName: dto.serverName,
        groupId: dto.groupId,
        createdById: actor.id,
        expiresAt: new Date(Date.now() + (dto.ttlMinutes ?? DEFAULT_TTL_MINUTES) * 60_000),
      },
    });

    await this.audit.record({
      userId: actor.id,
      actorLabel: actor.email,
      action: 'registration_token.create',
      resourceType: 'registration_token',
      resourceId: record.id,
      ipAddress,
      result: AuditResult.SUCCESS,
      metadata: { osFamily: dto.osFamily, osVersion: dto.osVersion, architecture: dto.architecture, serverName: dto.serverName, expiresAt: record.expiresAt },
    });

    return { token: plaintext, record: this.toView(record) };
  }

  async list(): Promise<RegistrationTokenView[]> {
    const tokens = await this.prisma.registrationToken.findMany({
      include: { createdBy: { select: { email: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return tokens.map((t) => this.toView(t));
  }

  async revoke(actor: AuthenticatedUser, id: string, ipAddress: string | null): Promise<void> {
    const token = await this.prisma.registrationToken.findUnique({ where: { id } });
    if (!token) throw AppError.notFound('REGISTRATION_TOKEN_NOT_FOUND');
    if (tokenStatus(token) !== 'ACTIVE') throw AppError.conflict('REGISTRATION_TOKEN_NOT_ACTIVE');
    await this.prisma.registrationToken.update({ where: { id }, data: { revokedAt: new Date() } });
    await this.audit.record({
      userId: actor.id,
      actorLabel: actor.email,
      action: 'registration_token.revoke',
      resourceType: 'registration_token',
      resourceId: id,
      ipAddress,
      result: AuditResult.SUCCESS,
    });
  }

  /** Belirteci doğrular ve kayıt için döndürür; kullanım işareti kayıt işlemi içinde atılır. */
  async findActiveByPlaintext(plaintext: string): Promise<RegistrationToken | null> {
    const token = await this.prisma.registrationToken.findUnique({ where: { tokenHash: sha256(plaintext) } });
    if (!token || tokenStatus(token) !== 'ACTIVE') return null;
    return token;
  }

  async purgeExpired(olderThanDays = 7): Promise<number> {
    const threshold = new Date(Date.now() - olderThanDays * 86_400_000);
    const result = await this.prisma.registrationToken.deleteMany({
      where: { usedAt: null, expiresAt: { lt: threshold } },
    });
    return result.count;
  }
}
