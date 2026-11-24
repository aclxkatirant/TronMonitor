import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ALL_PERMISSIONS } from '../../permissions/permission-catalog';

const trim = Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

export class CreateApiTokenDto {
  @ApiProperty()
  @trim
  @IsString()
  @MinLength(1, { message: 'Belirteç adı boş olamaz.' })
  @MaxLength(80, { message: 'Belirteç adı en fazla 80 karakter olabilir.' })
  name!: string;

  @ApiProperty({ type: [String], description: 'Belirtecin kullanabileceği izinler (kendi izinlerinizin alt kümesi)' })
  @IsArray()
  @ArrayMinSize(1, { message: 'En az bir izin seçin.' })
  @ArrayMaxSize(50)
  @IsIn(ALL_PERMISSIONS, { each: true, message: 'Geçersiz izin anahtarı.' })
  scopes!: string[];

  @ApiPropertyOptional({ description: 'Geçerlilik süresi (gün); boşsa süresiz' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  expiresInDays?: number;
}
