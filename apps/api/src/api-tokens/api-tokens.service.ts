import { Injectable } from '@nestjs/common';
import { AuditResult, type ApiToken, type User } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/app-error';
import { generateToken, sha256 } from '../common/crypto';
import { PermissionsService } from '../permissions/permissions.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { CreateApiTokenDto } from './dto/api-tokens.dto';

export const API_TOKEN_PREFIX = 'tmk_';
const TOUCH_INTERVAL_MS = 60_000;

export interface ApiTokenView {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
  owner?: { id: string; fullName: string; email: string };
}

export interface ValidatedApiToken {
  token: ApiToken;
  user: User;
  permissions: string[];
}

function status(token: ApiToken): ApiTokenView['status'] {
  if (token.revokedAt) return 'REVOKED';
  if (token.expiresAt && token.expiresAt.getTime() <= Date.now()) return 'EXPIRED';
  return 'ACTIVE';
}

@Injectable()
export class ApiTokensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly permissions: PermissionsService,
  ) {}

  private toView(token: ApiToken & { user?: { id: string; fullName: string; email: string } }): ApiTokenView {
    return { id: token.id, name: token.name, tokenPrefix: token.tokenPrefix, scopes: token.scopes, expiresAt: token.expiresAt, lastUsedAt: token.lastUsedAt, revokedAt: token.revokedAt, createdAt: token.createdAt, status: status(token), owner: token.user };
  }

  /** Belirteç kapsamı, sahibinin etkin izinlerinin alt kümesi olmalıdır. */
  async create(actor: AuthenticatedUser, dto: CreateApiTokenDto, ipAddress: string | null): Promise<{ token: string; record: ApiTokenView }> {
    const scopes = [...new Set(dto.scopes)];
    const granted = new Set(actor.permissions);
    if (scopes.some((s) => !granted.has(s))) throw AppError.forbidden('API_TOKEN_SCOPE_EXCEEDS');
    const secret = generateToken(32);
    const plaintext = `${API_TOKEN_PREFIX}${secret}`;
    const record = await this.prisma.apiToken.create({
      data: {
        userId: actor.id,
        name: dto.name,
        tokenPrefix: plaintext.slice(0, 12),
        tokenHash: sha256(plaintext),
        scopes,
        expiresAt: dto.expiresInDays ? new Date(Date.now() + dto.expiresInDays * 86_400_000) : null,
      },
    });
    await this.audit.record({ userId: actor.id, actorLabel: actor.email, action: 'api_token.create', resourceType: 'api_token', resourceId: record.id, ipAddress, result: AuditResult.SUCCESS, metadata: { name: dto.name, scopes, expiresAt: record.expiresAt } });
    return { token: plaintext, record: this.toView(record) };
  }

  async list(actor: AuthenticatedUser, all: boolean): Promise<ApiTokenView[]> {
    const canAll = all && actor.permissions.includes('apitokens.manage_all');
    const tokens = await this.prisma.apiToken.findMany({
      where: canAll ? {} : { userId: actor.id },
      include: { user: { select: { id: true, fullName: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return tokens.map((t) => this.toView(t));
  }

  async revoke(actor: AuthenticatedUser, id: string, ipAddress: string | null): Promise<void> {
    const token = await this.prisma.apiToken.findUnique({ where: { id } });
    if (!token) throw AppError.notFound('API_TOKEN_NOT_FOUND');
    if (token.userId !== actor.id && !actor.permissions.includes('apitokens.manage_all')) throw AppError.forbidden();
    if (token.revokedAt) return;
    await this.prisma.apiToken.update({ where: { id }, data: { revokedAt: new Date() } });
    await this.audit.record({ userId: actor.id, actorLabel: actor.email, action: 'api_token.revoke', resourceType: 'api_token', resourceId: id, ipAddress, result: AuditResult.SUCCESS, metadata: { name: token.name, ownerId: token.userId } });
  }

  /** Bearer belirtecini doğrular; etkin izinler = sahibinin izinleri ∩ belirteç kapsamı. */
  async validate(plaintext: string): Promise<ValidatedApiToken | null> {
    if (!plaintext.startsWith(API_TOKEN_PREFIX) || plaintext.length > 128) return null;
    const token = await this.prisma.apiToken.findUnique({ where: { tokenHash: sha256(plaintext) }, include: { user: true } });
    if (!token || status(token) !== 'ACTIVE' || !token.user.isActive) return null;
    const effective = await this.permissions.getEffectivePermissions(token.user.id, token.user.role);
    const scoped = effective.filter((p) => token.scopes.includes(p));
    if (!token.lastUsedAt || Date.now() - token.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.prisma.apiToken.update({ where: { id: token.id }, data: { lastUsedAt: new Date() } });
    }
    const { user, ...rest } = token;
    return { token: rest, user, permissions: scoped };
  }
}
