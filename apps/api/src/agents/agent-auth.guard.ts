import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { CredentialStatus } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { EncryptionService } from '../common/encryption.service';
import { AppError } from '../common/app-error';
import {
  AGENT_HEADERS,
  AGENT_NONCE_TTL_SECONDS,
  isNonceWellFormed,
  isTimestampFresh,
  verifySignature,
} from './agent-signing';

export interface AuthenticatedAgent {
  agentId: string;
  serverId: string;
  credentialId: string;
  keyId: string;
}

export interface AgentRequest extends Request {
  agent?: AuthenticatedAgent;
  rawBody?: Buffer;
}

/**
 * Ajan isteklerini HMAC imzası, zaman damgası ve tek kullanımlık nonce ile doğrular (yeniden oynatma koruması).
 */
@Injectable()
export class AgentAuthGuard implements CanActivate {
  private readonly logger = new Logger(AgentAuthGuard.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly encryption: EncryptionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AgentRequest>();
    const keyId = request.header(AGENT_HEADERS.KEY) ?? '';
    const timestamp = request.header(AGENT_HEADERS.TIMESTAMP) ?? '';
    const nonce = request.header(AGENT_HEADERS.NONCE) ?? '';
    const signature = request.header(AGENT_HEADERS.SIGNATURE) ?? '';

    if (!keyId || !timestamp || !nonce || !signature) throw AppError.unauthorized('AGENT_AUTH_REQUIRED');
    if (!/^tma_[0-9a-f]{32}$/.test(keyId)) throw AppError.unauthorized('AGENT_AUTH_INVALID');
    if (!isTimestampFresh(timestamp)) throw AppError.unauthorized('AGENT_TIMESTAMP_SKEW');
    if (!isNonceWellFormed(nonce)) throw AppError.unauthorized('AGENT_AUTH_INVALID');

    const credential = await this.prisma.agentCredential.findUnique({
      where: { keyId },
      include: { agent: { select: { id: true, serverId: true, status: true } } },
    });
    if (!credential) throw AppError.unauthorized('AGENT_AUTH_INVALID');
    if (credential.status !== CredentialStatus.ACTIVE || credential.revokedAt) {
      throw AppError.unauthorized('AGENT_CREDENTIAL_REVOKED');
    }
    if (credential.expiresAt && credential.expiresAt.getTime() < Date.now()) {
      throw AppError.unauthorized('AGENT_CREDENTIAL_REVOKED');
    }

    let secret: string;
    try {
      secret = this.encryption.decrypt(credential.secretEncrypted, credential.keyId);
    } catch (error) {
      this.logger.error(`Ajan sırrı çözülemedi (${keyId}): ${error instanceof Error ? error.message : String(error)}`);
      throw AppError.unauthorized('AGENT_AUTH_INVALID');
    }

    const valid = verifySignature(
      secret,
      {
        method: request.method,
        requestUri: request.originalUrl,
        timestamp,
        nonce,
        body: request.rawBody ?? Buffer.alloc(0),
      },
      signature,
    );
    if (!valid) throw AppError.unauthorized('AGENT_AUTH_INVALID');

    // Nonce yalnızca bir kez kabul edilir; aynı imzalı istek tekrar gönderilirse reddedilir.
    const nonceKey = `agent:nonce:${keyId}:${nonce.toLowerCase()}`;
    const stored = await this.redis.client.set(nonceKey, '1', 'EX', AGENT_NONCE_TTL_SECONDS, 'NX');
    if (stored !== 'OK') throw AppError.unauthorized('AGENT_REPLAY_DETECTED');

    request.agent = {
      agentId: credential.agent.id,
      serverId: credential.agent.serverId,
      credentialId: credential.id,
      keyId,
    };
    return true;
  }
}
