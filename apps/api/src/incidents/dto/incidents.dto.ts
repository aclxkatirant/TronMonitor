import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { IncidentSeverity, IncidentStatus, IncidentType } from '../../generated/prisma/client';

const toInt = Transform(({ value }: { value: unknown }) => (value === undefined || value === '' ? undefined : Number(value)));
const trim = Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

export class ListIncidentsQueryDto {
  @ApiPropertyOptional({ enum: [...Object.values(IncidentStatus), 'active'], description: '"active" = açık veya üstlenilmiş' })
  @IsOptional()
  @IsIn([...Object.values(IncidentStatus), 'active'])
  status?: IncidentStatus | 'active';

  @ApiPropertyOptional({ enum: IncidentSeverity })
  @IsOptional()
  @IsEnum(IncidentSeverity)
  severity?: IncidentSeverity;

  @ApiPropertyOptional({ enum: IncidentType })
  @IsOptional()
  @IsEnum(IncidentType)
  type?: IncidentType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  serverId?: string;

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

export class IncidentActionDto {
  @ApiPropertyOptional({ description: 'İsteğe bağlı not' })
  @IsOptional()
  @trim
  @IsString()
  @MaxLength(2000, { message: 'Not en fazla 2000 karakter olabilir.' })
  note?: string;
}
