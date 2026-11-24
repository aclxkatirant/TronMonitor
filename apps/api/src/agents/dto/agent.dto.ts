import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { OsFamily } from '../../generated/prisma/client';

export class HostInfoDto {
  @ApiProperty()
  @IsString()
  @MaxLength(255)
  hostname!: string;

  @ApiProperty({ enum: OsFamily })
  @IsEnum(OsFamily, { message: 'osFamily WINDOWS veya LINUX olmalıdır.' })
  osFamily!: OsFamily;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  osName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  osVersion?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  osEdition?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  kernelVersion?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  architecture?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  cpuModel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4096)
  cpuCores?: number;

  @ApiPropertyOptional({ description: 'Bayt cinsinden toplam bellek' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  totalMemoryBytes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  bootTime?: string;
}

export class RegisterAgentDto {
  @ApiProperty({ description: 'Panodan üretilen kayıt belirteci' })
  @IsString()
  @Matches(/^tmr_[A-Za-z0-9_-]{40,64}$/, { message: 'Kayıt belirteci biçimi geçersiz.' })
  registrationToken!: string;

  @ApiProperty()
  @IsString()
  @Matches(/^\d+\.\d+\.\d+(-[A-Za-z0-9.]+)?$/, { message: 'Ajan sürümü geçersiz.' })
  agentVersion!: string;

  @ApiProperty({ type: HostInfoDto })
  @ValidateNested()
  @Type(() => HostInfoDto)
  host!: HostInfoDto;
}

export class HeartbeatDto {
  @ApiProperty()
  @IsString()
  @Matches(/^\d+\.\d+\.\d+(-[A-Za-z0-9.]+)?$/, { message: 'Ajan sürümü geçersiz.' })
  agentVersion!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  uptimeSeconds?: number;

  @ApiProperty({ type: HostInfoDto })
  @ValidateNested()
  @Type(() => HostInfoDto)
  host!: HostInfoDto;
}

export class CpuMetricDto {
  @ApiProperty()
  @IsNumber()
  @Min(0)
  @Max(100)
  percent!: number;
}

export class MemoryMetricDto {
  @ApiProperty()
  @IsNumber()
  @Min(0)
  totalBytes!: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  usedBytes!: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  availableBytes!: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  @Max(100)
  percent!: number;
}

export class LoadAverageDto {
  @ApiProperty()
  @IsNumber()
  @Min(0)
  load1!: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  load5!: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  load15!: number;
}

export class DiskMetricDto {
  @ApiProperty({ description: 'Windows: sürücü harfi (C:), Linux: bağlama noktası (/)' })
  @IsString()
  @MaxLength(255)
  volume!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  fsType?: string;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  totalBytes!: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  usedBytes!: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  freeBytes!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  readBytesPerSec?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  writeBytesPerSec?: number;
}

export class NetworkMetricDto {
  @ApiProperty()
  @IsString()
  @MaxLength(128)
  name!: string;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  rxBytesPerSec!: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  txBytesPerSec!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isUp?: boolean;
}

export class MetricSampleDto {
  @ApiProperty()
  @IsISO8601()
  timestamp!: string;

  @ApiProperty({ type: CpuMetricDto })
  @ValidateNested()
  @Type(() => CpuMetricDto)
  cpu!: CpuMetricDto;

  @ApiProperty({ type: MemoryMetricDto })
  @ValidateNested()
  @Type(() => MemoryMetricDto)
  memory!: MemoryMetricDto;

  @ApiPropertyOptional({ type: LoadAverageDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => LoadAverageDto)
  loadAverage?: LoadAverageDto;

  @ApiProperty({ type: [DiskMetricDto] })
  @IsArray()
  @ArrayMaxSize(256)
  @ValidateNested({ each: true })
  @Type(() => DiskMetricDto)
  disks!: DiskMetricDto[];

  @ApiProperty({ type: [NetworkMetricDto] })
  @IsArray()
  @ArrayMaxSize(256)
  @ValidateNested({ each: true })
  @Type(() => NetworkMetricDto)
  network!: NetworkMetricDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  uptimeSeconds?: number;
}

export class MetricsBatchDto {
  @ApiProperty({ type: [MetricSampleDto] })
  @IsArray()
  @ArrayMaxSize(120)
  @ValidateNested({ each: true })
  @Type(() => MetricSampleDto)
  samples!: MetricSampleDto[];
}
