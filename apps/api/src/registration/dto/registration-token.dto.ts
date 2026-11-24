import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { OsFamily } from '../../generated/prisma/client';

export const SUPPORTED_OS_VERSIONS: Record<OsFamily, string[]> = {
  [OsFamily.WINDOWS]: ['windows-server-2019', 'windows-server-2022', 'windows-server-2025'],
  [OsFamily.LINUX]: ['ubuntu-22.04', 'ubuntu-24.04', 'debian-12'],
};

export const SUPPORTED_ARCHITECTURES = ['amd64', 'arm64'] as const;

const trim = Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

export class CreateRegistrationTokenDto {
  @ApiProperty({ enum: OsFamily })
  @IsEnum(OsFamily, { message: 'osFamily WINDOWS veya LINUX olmalıdır.' })
  osFamily!: OsFamily;

  @ApiPropertyOptional({ description: 'Desteklenen sürüm kimliği, ör. windows-server-2019, ubuntu-24.04' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  osVersion?: string;

  @ApiPropertyOptional({ enum: SUPPORTED_ARCHITECTURES })
  @IsOptional()
  @IsIn(SUPPORTED_ARCHITECTURES, { message: 'Mimari amd64 veya arm64 olmalıdır.' })
  architecture?: (typeof SUPPORTED_ARCHITECTURES)[number];

  @ApiPropertyOptional({ description: 'Sunucuya panoda verilecek ad; boşsa ana makine adı kullanılır' })
  @IsOptional()
  @trim
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  serverName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4', { message: 'Geçersiz grup kimliği.' })
  groupId?: string;

  @ApiPropertyOptional({ default: 60, description: 'Belirtecin geçerlilik süresi (dakika)' })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(24 * 60)
  ttlMinutes?: number;
}
