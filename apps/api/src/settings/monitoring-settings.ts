import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min, ValidateNested } from 'class-validator';

export const MONITORING_SETTINGS_KEY = 'monitoring';

export class ThresholdsDto {
  @ApiProperty({ default: 90, description: 'CPU kullanımı bu yüzdeyi aşarsa sunucu "sorunlu" olur' })
  @IsInt()
  @Min(50)
  @Max(100)
  cpuPercent!: number;

  @ApiProperty({ default: 90 })
  @IsInt()
  @Min(50)
  @Max(100)
  memoryPercent!: number;

  @ApiProperty({ default: 90, description: 'Herhangi bir disk hacmi bu yüzdeyi aşarsa' })
  @IsInt()
  @Min(50)
  @Max(100)
  diskPercent!: number;

  @ApiProperty({ default: 3, description: 'Eşik bu kadar ardışık örnekte aşılırsa durum değişir' })
  @IsInt()
  @Min(1)
  @Max(20)
  consecutiveSamples!: number;
}

export class RetentionDto {
  @ApiProperty({ default: 7, description: 'Ham örneklerin saklanma süresi (gün)' })
  @IsInt()
  @Min(1)
  @Max(90)
  rawDays!: number;

  @ApiProperty({ default: 30, description: '5 dakikalık özetlerin saklanma süresi (gün)' })
  @IsInt()
  @Min(7)
  @Max(365)
  minute5Days!: number;

  @ApiProperty({ default: 365, description: 'Saatlik özetlerin saklanma süresi (gün)' })
  @IsInt()
  @Min(30)
  @Max(1825)
  hour1Days!: number;

  @ApiProperty({ default: 730, description: 'Günlük özetlerin saklanma süresi (gün)' })
  @IsInt()
  @Min(90)
  @Max(3650)
  day1Days!: number;
}

export class MonitoringSettingsDto {
  @ApiProperty({ type: ThresholdsDto })
  @ValidateNested()
  @Type(() => ThresholdsDto)
  thresholds!: ThresholdsDto;

  @ApiProperty({ type: RetentionDto })
  @ValidateNested()
  @Type(() => RetentionDto)
  retention!: RetentionDto;
}

export interface MonitoringSettings {
  thresholds: { cpuPercent: number; memoryPercent: number; diskPercent: number; consecutiveSamples: number };
  retention: { rawDays: number; minute5Days: number; hour1Days: number; day1Days: number };
}

export const DEFAULT_MONITORING_SETTINGS: MonitoringSettings = {
  thresholds: { cpuPercent: 90, memoryPercent: 90, diskPercent: 90, consecutiveSamples: 3 },
  retention: { rawDays: 7, minute5Days: 30, hour1Days: 365, day1Days: 730 },
};
