import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { ServiceState } from '../../generated/prisma/client';

/**
 * Windows hizmet adları boşluk ve parantez içerebilir ("Bonjour Service"); SCM yalnızca "/" ve "\" karakterlerini yasaklar.
 * systemd birim adları zaten daha dar bir kümedir. Ad hiçbir zaman kabuğa verilmez (Windows SCM API, `systemctl -- <ad>`).
 */
export const SERVICE_NAME_PATTERN = /^[^\x00-\x1f\x7f/\\]{1,256}$/;
export const SERVICE_ACTIONS = ['start', 'stop', 'restart'] as const;
export type ServiceAction = (typeof SERVICE_ACTIONS)[number];

const toInt = Transform(({ value }: { value: unknown }) => (value === undefined || value === '' ? undefined : Number(value)));
const toBool = Transform(({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value));

export class ServiceItemDto {
  @ApiProperty()
  @IsString()
  @Matches(SERVICE_NAME_PATTERN, { message: 'Hizmet adı geçersiz.' })
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  displayName?: string;

  @ApiProperty({ enum: ServiceState })
  @IsEnum(ServiceState)
  state!: ServiceState;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  startupType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}

export class ServiceReportDto {
  @ApiProperty({ type: [ServiceItemDto] })
  @IsArray()
  @ArrayMaxSize(3000)
  @ValidateNested({ each: true })
  @Type(() => ServiceItemDto)
  services!: ServiceItemDto[];
}

export class CommandResultDto {
  @ApiProperty()
  @IsBoolean()
  ok!: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;
}

export class ListServicesQueryDto {
  @ApiPropertyOptional({ description: 'Ad veya görünen ad araması' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ description: 'Yalnızca izlenenler' })
  @IsOptional()
  @toBool
  @IsBoolean()
  monitored?: boolean;

  @ApiPropertyOptional({ enum: ServiceState })
  @IsOptional()
  @IsEnum(ServiceState)
  state?: ServiceState;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @toInt
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 100 })
  @IsOptional()
  @toInt
  @IsInt()
  @Min(1)
  @Max(500)
  pageSize = 100;
}

export class UpdateMonitoredServiceDto {
  @ApiProperty()
  @IsBoolean()
  isMonitored!: boolean;
}

export class ServiceControlDto {
  @ApiProperty({ enum: SERVICE_ACTIONS })
  @IsIn(SERVICE_ACTIONS, { message: 'Eylem start, stop veya restart olmalıdır.' })
  action!: ServiceAction;
}

export class ListCommandsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  serverId?: string;

  @ApiPropertyOptional({ default: 25 })
  @IsOptional()
  @toInt
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 25;
}
