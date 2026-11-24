import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { CheckType } from '../../generated/prisma/client';

const trim = Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));
const toInt = Transform(({ value }: { value: unknown }) => (value === undefined || value === '' ? undefined : Number(value)));

export const HTTP_METHODS = ['GET', 'HEAD', 'POST'] as const;

export class CreateCheckDto {
  @ApiProperty()
  @trim
  @IsString()
  @MinLength(1, { message: 'Kontrol adı boş olamaz.' })
  @MaxLength(120, { message: 'Kontrol adı en fazla 120 karakter olabilir.' })
  name!: string;

  @ApiProperty({ enum: CheckType })
  @IsEnum(CheckType, { message: 'Geçersiz kontrol türü.' })
  type!: CheckType;

  @ApiProperty({ description: 'HTTP/HTTPS için tam adres; TCP ve ICMP için ana makine adı veya IP' })
  @trim
  @IsString()
  @MinLength(1, { message: 'Hedef boş olamaz.' })
  @MaxLength(2048)
  target!: string;

  @ApiPropertyOptional({ description: 'TCP için port' })
  @IsOptional()
  @toInt
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @ApiPropertyOptional({ enum: HTTP_METHODS, default: 'GET' })
  @IsOptional()
  @IsIn(HTTP_METHODS, { message: 'HTTP yöntemi GET, HEAD veya POST olmalıdır.' })
  method?: (typeof HTTP_METHODS)[number];

  @ApiPropertyOptional({ description: 'Beklenen HTTP durum kodu; boşsa 2xx/3xx başarılı sayılır' })
  @IsOptional()
  @toInt
  @IsInt()
  @Min(100)
  @Max(599)
  expectedStatusCode?: number;

  @ApiPropertyOptional({ default: 60 })
  @IsOptional()
  @toInt
  @IsInt()
  @Min(10, { message: 'Kontrol aralığı en az 10 saniye olmalıdır.' })
  @Max(86400)
  intervalSec?: number;

  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @toInt
  @IsInt()
  @Min(1)
  @Max(120)
  timeoutSec?: number;

  @ApiPropertyOptional({ default: 2 })
  @IsOptional()
  @toInt
  @IsInt()
  @Min(0)
  @Max(5)
  retryCount?: number;

  @ApiPropertyOptional({ default: 3 })
  @IsOptional()
  @toInt
  @IsInt()
  @Min(1)
  @Max(20)
  failureThreshold?: number;

  @ApiPropertyOptional({ default: 2 })
  @IsOptional()
  @toInt
  @IsInt()
  @Min(1)
  @Max(20)
  recoveryThreshold?: number;

  @ApiPropertyOptional({ description: 'HTTPS: sertifika bitimine bu kadar gün kala uyar (boş: izleme yok)' })
  @IsOptional()
  @toInt
  @IsInt()
  @Min(1)
  @Max(365)
  sslExpiryWarnDays?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  notifyOnFailure?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @ApiPropertyOptional({ description: 'İlişkili sunucu (isteğe bağlı)' })
  @IsOptional()
  @IsUUID('4', { message: 'Geçersiz sunucu kimliği.' })
  serverId?: string | null;
}

export class UpdateCheckDto extends CreateCheckDto {
  @IsOptional()
  declare name: string;

  @IsOptional()
  declare type: CheckType;

  @IsOptional()
  declare target: string;
}

export class ListChecksQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  serverId?: string;

  @ApiPropertyOptional({ enum: CheckType })
  @IsOptional()
  @IsEnum(CheckType)
  type?: CheckType;
}

export class ResultsQueryDto {
  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @toInt
  @IsInt()
  @Min(1)
  @Max(500)
  limit = 50;
}
