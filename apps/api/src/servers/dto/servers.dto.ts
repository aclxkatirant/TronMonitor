import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { OsFamily, ServerStatus } from '../../generated/prisma/client';

const trim = Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));
const toInt = Transform(({ value }: { value: unknown }) => (value === undefined || value === '' ? undefined : Number(value)));
const nullableTrim = Transform(({ value }: { value: unknown }) => (value === null ? null : typeof value === 'string' ? value.trim() : value));

export const SERVER_SORT_FIELDS = ['name', 'status', 'osFamily', 'lastHeartbeatAt', 'registeredAt'] as const;

export class ListServersQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @trim
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ enum: OsFamily })
  @IsOptional()
  @IsEnum(OsFamily)
  osFamily?: OsFamily;

  @ApiPropertyOptional({ enum: ServerStatus })
  @IsOptional()
  @IsEnum(ServerStatus)
  status?: ServerStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  groupId?: string;

  @ApiPropertyOptional({ description: 'Etiket kimliği' })
  @IsOptional()
  @IsUUID('4')
  tagId?: string;

  @ApiPropertyOptional({ enum: SERVER_SORT_FIELDS, default: 'name' })
  @IsOptional()
  @IsIn(SERVER_SORT_FIELDS)
  sort: (typeof SERVER_SORT_FIELDS)[number] = 'name';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order: 'asc' | 'desc' = 'asc';

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

export class UpdateServerDto {
  @ApiPropertyOptional()
  @IsOptional()
  @trim
  @IsString()
  @MinLength(1, { message: 'Sunucu adı boş olamaz.' })
  @MaxLength(120, { message: 'Sunucu adı en fazla 120 karakter olabilir.' })
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @nullableTrim
  @IsString()
  @MaxLength(1000, { message: 'Açıklama en fazla 1000 karakter olabilir.' })
  description?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID('4', { message: 'Geçersiz grup kimliği.' })
  groupId?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true, message: 'Geçersiz etiket kimliği.' })
  tagIds?: string[];
}

export class UpdateAgentSettingsDto {
  @ApiPropertyOptional({ minimum: 5, maximum: 3600 })
  @IsOptional()
  @IsInt({ message: 'Toplama aralığı tam sayı olmalıdır.' })
  @Min(5, { message: 'Toplama aralığı en az 5 saniye olmalıdır.' })
  @Max(3600, { message: 'Toplama aralığı en fazla 3600 saniye olabilir.' })
  collectionIntervalSec?: number;
}

export class ListEventsQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @toInt
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 25 })
  @IsOptional()
  @toInt
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 25;
}

export class GroupDto {
  @ApiPropertyOptional()
  @trim
  @IsString()
  @MinLength(1, { message: 'Grup adı boş olamaz.' })
  @MaxLength(80, { message: 'Grup adı en fazla 80 karakter olabilir.' })
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @nullableTrim
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Hex renk, ör. #22c55e' })
  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'Renk #rrggbb biçiminde olmalıdır.' })
  color?: string | null;
}

export class UpdateGroupDto {
  @ApiPropertyOptional()
  @IsOptional()
  @trim
  @IsString()
  @MinLength(1, { message: 'Grup adı boş olamaz.' })
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @nullableTrim
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'Renk #rrggbb biçiminde olmalıdır.' })
  color?: string | null;
}

export class TagDto {
  @ApiPropertyOptional()
  @trim
  @IsString()
  @MinLength(1, { message: 'Etiket adı boş olamaz.' })
  @MaxLength(40, { message: 'Etiket adı en fazla 40 karakter olabilir.' })
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'Renk #rrggbb biçiminde olmalıdır.' })
  color?: string | null;
}
