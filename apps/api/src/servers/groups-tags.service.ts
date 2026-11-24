import { Injectable } from '@nestjs/common';
import { AuditResult } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/app-error';
import { RealtimeService } from '../realtime/realtime.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { GroupDto, TagDto, UpdateGroupDto } from './dto/servers.dto';

/** Ad karşılaştırması veritabanı yerel ayarından bağımsız olarak Türkçe kurallarıyla yapılır. */
function normalizeName(name: string): string {
  return name.trim().toLocaleLowerCase('tr-TR');
}

@Injectable()
export class GroupsTagsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  private async groupNameTaken(name: string, exceptId?: string): Promise<boolean> {
    const groups = await this.prisma.serverGroup.findMany({ select: { id: true, name: true } });
    const target = normalizeName(name);
    return groups.some((g) => g.id !== exceptId && normalizeName(g.name) === target);
  }

  private async tagNameTaken(name: string): Promise<boolean> {
    const tags = await this.prisma.tag.findMany({ select: { name: true } });
    const target = normalizeName(name);
    return tags.some((t) => normalizeName(t.name) === target);
  }

  async listGroups() {
    const groups = await this.prisma.serverGroup.findMany({ include: { _count: { select: { servers: true } } }, orderBy: { name: 'asc' } });
    return groups.map((g) => ({ id: g.id, name: g.name, description: g.description, color: g.color, serverCount: g._count.servers, createdAt: g.createdAt }));
  }

  async createGroup(actor: AuthenticatedUser, dto: GroupDto, ipAddress: string | null) {
    if (await this.groupNameTaken(dto.name)) throw AppError.conflict('SERVER_GROUP_EXISTS');
    const group = await this.prisma.serverGroup.create({ data: { name: dto.name, description: dto.description ?? null, color: dto.color ?? null } });
    await this.audit.record({ userId: actor.id, actorLabel: actor.email, action: 'server_group.create', resourceType: 'server_group', resourceId: group.id, ipAddress, result: AuditResult.SUCCESS, metadata: { name: group.name } });
    return { ...group, serverCount: 0 };
  }

  async updateGroup(actor: AuthenticatedUser, id: string, dto: UpdateGroupDto, ipAddress: string | null) {
    const group = await this.prisma.serverGroup.findUnique({ where: { id } });
    if (!group) throw AppError.notFound('SERVER_GROUP_NOT_FOUND');
    if (dto.name && (await this.groupNameTaken(dto.name, id))) throw AppError.conflict('SERVER_GROUP_EXISTS');
    const updated = await this.prisma.serverGroup.update({ where: { id }, data: { name: dto.name, description: dto.description, color: dto.color }, include: { _count: { select: { servers: true } } } });
    await this.audit.record({ userId: actor.id, actorLabel: actor.email, action: 'server_group.update', resourceType: 'server_group', resourceId: id, ipAddress, result: AuditResult.SUCCESS, metadata: { changes: dto } });
    this.realtime.emit('server.updated', { groupId: id });
    return { id: updated.id, name: updated.name, description: updated.description, color: updated.color, serverCount: updated._count.servers, createdAt: updated.createdAt };
  }

  async deleteGroup(actor: AuthenticatedUser, id: string, ipAddress: string | null): Promise<void> {
    const group = await this.prisma.serverGroup.findUnique({ where: { id } });
    if (!group) throw AppError.notFound('SERVER_GROUP_NOT_FOUND');
    // Sunucular silinmez; grup bağlantısı kaldırılır (onDelete: SetNull).
    await this.prisma.serverGroup.delete({ where: { id } });
    await this.audit.record({ userId: actor.id, actorLabel: actor.email, action: 'server_group.delete', resourceType: 'server_group', resourceId: id, ipAddress, result: AuditResult.SUCCESS, metadata: { name: group.name } });
    this.realtime.emit('server.updated', { groupId: id });
  }

  async listTags() {
    const tags = await this.prisma.tag.findMany({ include: { _count: { select: { servers: true } } }, orderBy: { name: 'asc' } });
    return tags.map((t) => ({ id: t.id, name: t.name, color: t.color, serverCount: t._count.servers }));
  }

  async createTag(actor: AuthenticatedUser, dto: TagDto, ipAddress: string | null) {
    if (await this.tagNameTaken(dto.name)) throw AppError.conflict('TAG_EXISTS');
    const tag = await this.prisma.tag.create({ data: { name: dto.name, color: dto.color ?? null } });
    await this.audit.record({ userId: actor.id, actorLabel: actor.email, action: 'tag.create', resourceType: 'tag', resourceId: tag.id, ipAddress, result: AuditResult.SUCCESS, metadata: { name: tag.name } });
    return { ...tag, serverCount: 0 };
  }

  async deleteTag(actor: AuthenticatedUser, id: string, ipAddress: string | null): Promise<void> {
    const tag = await this.prisma.tag.findUnique({ where: { id } });
    if (!tag) throw AppError.notFound('TAG_NOT_FOUND');
    await this.prisma.tag.delete({ where: { id } });
    await this.audit.record({ userId: actor.id, actorLabel: actor.email, action: 'tag.delete', resourceType: 'tag', resourceId: id, ipAddress, result: AuditResult.SUCCESS, metadata: { name: tag.name } });
    this.realtime.emit('server.updated', { tagId: id });
  }
}
