import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsISO8601, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { AuditResult, type Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RequirePermissions } from '../auth/decorators';
import { PERMISSIONS } from '../permissions/permission-catalog';

const toInt = Transform(({ value }: { value: unknown }) => (value === undefined || value === '' ? undefined : Number(value)));
const trim = Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

export class ListAuditQueryDto {
  @ApiPropertyOptional({ description: 'Eylem, aktör, kaynak kimliği veya meta veri içinde arama' })
  @IsOptional()
  @trim
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @trim
  @IsString()
  @MaxLength(80)
  action?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  userId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @trim
  @IsString()
  @MaxLength(40)
  resourceType?: string;

  @ApiPropertyOptional({ enum: AuditResult })
  @IsOptional()
  @IsEnum(AuditResult)
  result?: AuditResult;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @toInt
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @toInt
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize = 50;
}

export const AUDIT_RESULT_LABELS: Record<AuditResult, string> = { SUCCESS: 'Başarılı', FAILURE: 'Başarısız', DENIED: 'Reddedildi' };

/** İşlem kayıtları yalnızca okunur; değiştirme veya silme uç noktası yoktur. */
@ApiTags('İşlem kayıtları')
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.AUDIT_READ)
  @ApiOperation({ summary: 'İşlem kayıtlarını filtreleyerek listele' })
  async list(@Query() query: ListAuditQueryDto) {
    const where: Prisma.AuditLogWhereInput = {
      ...(query.action ? { action: query.action } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.resourceType ? { resourceType: query.resourceType } : {}),
      ...(query.result ? { result: query.result } : {}),
      ...(query.from || query.to ? { createdAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } } : {}),
      ...(query.search
        ? {
            OR: [
              { action: { contains: query.search, mode: 'insensitive' } },
              { actorLabel: { contains: query.search, mode: 'insensitive' } },
              { resourceId: { contains: query.search, mode: 'insensitive' } },
              { ipAddress: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: { user: { select: { id: true, fullName: true, email: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return {
      items: items.map((l) => ({
        id: l.id.toString(),
        action: l.action,
        actorLabel: l.actorLabel,
        user: l.user,
        resourceType: l.resourceType,
        resourceId: l.resourceId,
        ipAddress: l.ipAddress,
        result: l.result,
        resultLabel: AUDIT_RESULT_LABELS[l.result],
        metadata: l.metadata,
        createdAt: l.createdAt,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  @Get('meta')
  @RequirePermissions(PERMISSIONS.AUDIT_READ)
  @ApiOperation({ summary: 'Filtre seçenekleri: eylemler ve kaynak türleri' })
  async meta() {
    const [actions, resourceTypes] = await Promise.all([
      this.prisma.auditLog.findMany({ distinct: ['action'], select: { action: true }, orderBy: { action: 'asc' } }),
      this.prisma.auditLog.findMany({ distinct: ['resourceType'], select: { resourceType: true }, where: { resourceType: { not: null } }, orderBy: { resourceType: 'asc' } }),
    ]);
    return {
      actions: actions.map((a) => a.action),
      resourceTypes: resourceTypes.map((r) => r.resourceType).filter((r): r is string => !!r),
      results: Object.entries(AUDIT_RESULT_LABELS).map(([value, label]) => ({ value, label })),
    };
  }
}
