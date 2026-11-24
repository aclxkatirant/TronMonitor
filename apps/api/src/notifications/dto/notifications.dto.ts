import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsIn, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { NotificationChannelType } from '../../generated/prisma/client';
import { NOTIFICATION_EVENT_KEYS } from '../notification-events';

const trim = Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

export class CreateChannelDto {
  @ApiProperty()
  @trim
  @IsString()
  @MinLength(1, { message: 'Kanal adı boş olamaz.' })
  @MaxLength(80, { message: 'Kanal adı en fazla 80 karakter olabilir.' })
  name!: string;

  @ApiProperty({ enum: NotificationChannelType })
  @IsEnum(NotificationChannelType, { message: 'Geçersiz kanal türü.' })
  type!: NotificationChannelType;

  @ApiProperty({ description: 'Türe özel yapılandırma (Discord: webhookUrl; Telegram: botToken, chatId; E-posta: host, port, secure, username, password, from, to[])' })
  @IsObject({ message: 'Yapılandırma bir nesne olmalıdır.' })
  config!: Record<string, unknown>;

  @ApiProperty({ type: [String], description: 'Bildirim gönderilecek olay anahtarları' })
  @IsArray()
  @ArrayMaxSize(50)
  @IsIn(NOTIFICATION_EVENT_KEYS, { each: true, message: 'Geçersiz olay anahtarı.' })
  enabledEvents!: string[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}

export class UpdateChannelDto {
  @ApiPropertyOptional()
  @IsOptional()
  @trim
  @IsString()
  @MinLength(1, { message: 'Kanal adı boş olamaz.' })
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({ description: 'Yalnızca verilen alanlar güncellenir; boş bırakılan sır alanları korunur.' })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsIn(NOTIFICATION_EVENT_KEYS, { each: true, message: 'Geçersiz olay anahtarı.' })
  enabledEvents?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}
