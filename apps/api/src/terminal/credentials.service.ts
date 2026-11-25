import { Injectable } from '@nestjs/common';
import { utils as sshUtils } from 'ssh2';
import { AuditResult, CredentialType, type ServerCredential } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EncryptionService } from '../common/encryption.service';
import { AppError } from '../common/app-error';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { UpsertCredentialDto } from './dto/terminal.dto';

export interface CredentialView {
  type: CredentialType;
  username: string;
  host: string | null;
  port: number;
  hostFingerprint: string | null;
  updatedAt: Date;
}

export interface ResolvedCredential extends CredentialView {
  id: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

interface SecretPayload {
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

/**
 * Sunucu başına tek SSH kimlik bilgisi. Sır (parola veya özel anahtar) AES-256-GCM ile şifrelenir
 * (AAD = sunucu kimliği) ve hiçbir uç noktadan geri okunamaz; yalnızca SSH bağlantısı kurulurken çözülür.
 */
@Injectable()
export class CredentialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly encryption: EncryptionService,
  ) {}

  async get(serverId: string): Promise<CredentialView | null> {
    const row = await this.prisma.serverCredential.findFirst({ where: { serverId }, orderBy: { updatedAt: 'desc' } });
    return row ? this.toView(row) : null;
  }

  async upsert(actor: AuthenticatedUser, serverId: string, dto: UpsertCredentialDto, ipAddress: string | null): Promise<CredentialView> {
    const server = await this.prisma.server.findUnique({ where: { id: serverId }, select: { id: true, name: true } });
    if (!server) throw AppError.notFound('SERVER_NOT_FOUND');
    const existing = await this.prisma.serverCredential.findFirst({ where: { serverId } });
    const type = dto.type === 'SSH_KEY' ? CredentialType.SSH_KEY : CredentialType.SSH_PASSWORD;

    let secret: SecretPayload;
    if (type === CredentialType.SSH_KEY) {
      if (dto.privateKey) {
        const parsed = sshUtils.parseKey(dto.privateKey, dto.passphrase);
        if (parsed instanceof Error) throw AppError.badRequest('TERMINAL_KEY_INVALID');
        secret = { privateKey: dto.privateKey, passphrase: dto.passphrase || undefined };
      } else if (existing && existing.type === CredentialType.SSH_KEY) {
        secret = this.decode(existing);
      } else throw AppError.badRequest('TERMINAL_CREDENTIAL_INCOMPLETE');
    } else if (dto.password) {
      secret = { password: dto.password };
    } else if (existing && existing.type === CredentialType.SSH_PASSWORD) {
      secret = this.decode(existing);
    } else throw AppError.badRequest('TERMINAL_CREDENTIAL_INCOMPLETE');

    const encryptedSecret = this.encryption.encrypt(JSON.stringify(secret), serverId);
    const data = { type, username: dto.username, host: dto.host?.trim() || null, port: dto.port, encryptedSecret };
    // Adres veya port değişirse eski parmak izi anlamsızdır; ilk bağlantıda yeniden öğrenilir.
    const resetFingerprint = !existing || existing.host !== data.host || existing.port !== data.port;
    const row = existing
      ? await this.prisma.serverCredential.update({ where: { id: existing.id }, data: { ...data, hostFingerprint: resetFingerprint ? null : existing.hostFingerprint } })
      : await this.prisma.serverCredential.create({ data: { ...data, serverId } });
    await this.audit.record({ userId: actor.id, actorLabel: actor.email, action: existing ? 'terminal.credential.update' : 'terminal.credential.create', resourceType: 'server', resourceId: serverId, ipAddress, result: AuditResult.SUCCESS, metadata: { serverName: server.name, type, username: dto.username, host: data.host, port: dto.port } });
    return this.toView(row);
  }

  async remove(actor: AuthenticatedUser, serverId: string, ipAddress: string | null): Promise<void> {
    const existing = await this.prisma.serverCredential.findFirst({ where: { serverId }, include: { server: { select: { name: true } } } });
    if (!existing) throw AppError.notFound('TERMINAL_CREDENTIAL_NOT_FOUND');
    await this.prisma.serverCredential.delete({ where: { id: existing.id } });
    await this.audit.record({ userId: actor.id, actorLabel: actor.email, action: 'terminal.credential.delete', resourceType: 'server', resourceId: serverId, ipAddress, result: AuditResult.SUCCESS, metadata: { serverName: existing.server.name, username: existing.username } });
  }

  /** Yalnızca terminal servisi tarafından, bağlantı kurulurken çağrılır. */
  async resolve(serverId: string): Promise<ResolvedCredential | null> {
    const row = await this.prisma.serverCredential.findFirst({ where: { serverId }, orderBy: { updatedAt: 'desc' } });
    if (!row) return null;
    return { id: row.id, ...this.toView(row), ...this.decode(row) };
  }

  /** İlk başarılı bağlantıda öğrenilen sunucu anahtarı parmak izini kaydeder (TOFU). */
  async rememberFingerprint(credentialId: string, fingerprint: string): Promise<void> {
    await this.prisma.serverCredential.updateMany({ where: { id: credentialId, hostFingerprint: null }, data: { hostFingerprint: fingerprint } });
  }

  private decode(row: ServerCredential): SecretPayload {
    return JSON.parse(this.encryption.decrypt(row.encryptedSecret, row.serverId)) as SecretPayload;
  }

  private toView(row: ServerCredential): CredentialView {
    return { type: row.type, username: row.username, host: row.host, port: row.port, hostFingerprint: row.hostFingerprint, updatedAt: row.updatedAt };
  }
}
