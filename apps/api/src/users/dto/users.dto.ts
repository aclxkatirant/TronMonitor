import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsBoolean, IsEmail, IsEnum, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { UserRole } from '../../generated/prisma/client';
import { ALL_PERMISSIONS } from '../../permissions/permission-catalog';
import { PASSWORD_MIN_LENGTH, PASSWORD_PATTERN } from '../../auth/dto/auth.dto';

const trim = Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));
const lowerTrim = Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value));

export class CreateUserDto {
  @ApiProperty()
  @lowerTrim
  @IsEmail({}, { message: 'Geçerli bir e-posta adresi girin.' })
  @MaxLength(254)
  email!: string;

  @ApiProperty()
  @trim
  @IsString({ message: 'Ad soyad gereklidir.' })
  @MinLength(2, { message: 'Ad soyad en az 2 karakter olmalıdır.' })
  @MaxLength(120)
  fullName!: string;

  @ApiProperty({ minLength: PASSWORD_MIN_LENGTH })
  @IsString({ message: 'Parola gereklidir.' })
  @MinLength(PASSWORD_MIN_LENGTH, { message: `Parola en az ${PASSWORD_MIN_LENGTH} karakter olmalıdır.` })
  @MaxLength(256)
  @Matches(PASSWORD_PATTERN, { message: 'Parola en az bir harf ve bir rakam içermelidir.' })
  password!: string;

  @ApiProperty({ enum: UserRole })
  @IsEnum(UserRole, { message: 'Geçersiz rol.' })
  role!: UserRole;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsIn(ALL_PERMISSIONS, { each: true, message: 'Geçersiz izin anahtarı.' })
  permissions?: string[];
}

export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @trim
  @IsString()
  @MinLength(2, { message: 'Ad soyad en az 2 karakter olmalıdır.' })
  @MaxLength(120)
  fullName?: string;

  @ApiPropertyOptional({ enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole, { message: 'Geçersiz rol.' })
  role?: UserRole;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean({ message: 'isActive doğru/yanlış olmalıdır.' })
  isActive?: boolean;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsIn(ALL_PERMISSIONS, { each: true, message: 'Geçersiz izin anahtarı.' })
  permissions?: string[];

  @ApiPropertyOptional({ minLength: PASSWORD_MIN_LENGTH, description: 'Verilirse parola sıfırlanır ve kullanıcının tüm oturumları kapatılır.' })
  @IsOptional()
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, { message: `Parola en az ${PASSWORD_MIN_LENGTH} karakter olmalıdır.` })
  @MaxLength(256)
  @Matches(PASSWORD_PATTERN, { message: 'Parola en az bir harf ve bir rakam içermelidir.' })
  newPassword?: string;
}

export class ListUsersQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @trim
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => Number(value))
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 25 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 25;
}
