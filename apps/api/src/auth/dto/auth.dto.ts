import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_PATTERN = /^(?=.*[A-Za-zÇĞİÖŞÜçğıöşü])(?=.*\d).+$/;

const emailTransform = Transform(({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value,
);

export class LoginDto {
  @ApiProperty({ example: 'admin@ornek.com' })
  @emailTransform
  @IsEmail({}, { message: 'Geçerli bir e-posta adresi girin.' })
  @MaxLength(254, { message: 'E-posta adresi çok uzun.' })
  email!: string;

  @ApiProperty({ example: 'cok-gizli-parola-123' })
  @IsString({ message: 'Parola gereklidir.' })
  @MinLength(1, { message: 'Parola gereklidir.' })
  @MaxLength(256, { message: 'Parola çok uzun.' })
  password!: string;
}

export class RegisterDto {
  @ApiProperty({ example: 'admin@ornek.com' })
  @emailTransform
  @IsEmail({}, { message: 'Geçerli bir e-posta adresi girin.' })
  @MaxLength(254, { message: 'E-posta adresi çok uzun.' })
  email!: string;

  @ApiProperty({ example: 'Ayşe Yılmaz' })
  @IsString({ message: 'Ad soyad gereklidir.' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(2, { message: 'Ad soyad en az 2 karakter olmalıdır.' })
  @MaxLength(120, { message: 'Ad soyad en fazla 120 karakter olabilir.' })
  fullName!: string;

  @ApiProperty({ minLength: PASSWORD_MIN_LENGTH })
  @IsString({ message: 'Parola gereklidir.' })
  @MinLength(PASSWORD_MIN_LENGTH, { message: `Parola en az ${PASSWORD_MIN_LENGTH} karakter olmalıdır.` })
  @MaxLength(256, { message: 'Parola çok uzun.' })
  @Matches(PASSWORD_PATTERN, { message: 'Parola en az bir harf ve bir rakam içermelidir.' })
  password!: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString({ message: 'Mevcut parola gereklidir.' })
  @MinLength(1, { message: 'Mevcut parola gereklidir.' })
  @MaxLength(256)
  currentPassword!: string;

  @ApiProperty({ minLength: PASSWORD_MIN_LENGTH })
  @IsString({ message: 'Yeni parola gereklidir.' })
  @MinLength(PASSWORD_MIN_LENGTH, { message: `Yeni parola en az ${PASSWORD_MIN_LENGTH} karakter olmalıdır.` })
  @MaxLength(256, { message: 'Parola çok uzun.' })
  @Matches(PASSWORD_PATTERN, { message: 'Yeni parola en az bir harf ve bir rakam içermelidir.' })
  newPassword!: string;
}
