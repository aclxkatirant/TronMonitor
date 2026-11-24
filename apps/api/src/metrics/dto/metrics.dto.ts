import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsIn, IsOptional } from 'class-validator';

export const METRIC_RANGES = ['1h', '6h', '24h', '7d', '30d', 'custom'] as const;
export type MetricRange = (typeof METRIC_RANGES)[number];

export class MetricsQueryDto {
  @ApiPropertyOptional({ enum: METRIC_RANGES, default: '1h' })
  @IsOptional()
  @IsIn(METRIC_RANGES, { message: 'Geçersiz zaman aralığı.' })
  range: MetricRange = '1h';

  @ApiPropertyOptional({ description: 'Özel aralık başlangıcı (ISO 8601); yalnızca range=custom' })
  @IsOptional()
  @IsISO8601({}, { message: 'Başlangıç tarihi geçersiz.' })
  from?: string;

  @ApiPropertyOptional({ description: 'Özel aralık bitişi (ISO 8601); yalnızca range=custom' })
  @IsOptional()
  @IsISO8601({}, { message: 'Bitiş tarihi geçersiz.' })
  to?: string;
}
