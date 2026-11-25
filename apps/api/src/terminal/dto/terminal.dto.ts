import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export const SSH_CREDENTIAL_TYPES = ['SSH_PASSWORD', 'SSH_KEY'] as const;
export type SshCredentialType = (typeof SSH_CREDENTIAL_TYPES)[number];

const toInt = Transform(({ value }: { value: unknown }) => (value === undefined || value === '' ? undefined : Number(value)));

export class UpsertCredentialDto {
  @ApiProperty({ enum: SSH_CREDENTIAL_TYPES })
  @IsIn(SSH_CREDENTIAL_TYPES, { message: 'Kimlik bilgisi türü SSH_PASSWORD veya SSH_KEY olmalıdır.' })
  type!: SshCredentialType;

  @ApiProperty({ description: 'SSH kullanıcı adı' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  @Matches(/^[^\s]+$/, { message: 'Kullanıcı adı boşluk içeremez.' })
  username!: string;

  @ApiPropertyOptional({ description: 'Bağlantı adresi (IP veya DNS). Boşsa sunucunun ana bilgisayar adı kullanılır.' })
  @IsOptional()
  @IsString()
  @MaxLength(253)
  @Matches(/^[A-Za-z0-9.\-:[\]]*$/, { message: 'Bağlantı adresi geçersiz karakter içeriyor.' })
  host?: string;

  @ApiPropertyOptional({ default: 22 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port = 22;

  @ApiPropertyOptional({ description: 'SSH_PASSWORD için parola. Güncellemede boş bırakılırsa mevcut sır korunur.' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  password?: string;

  @ApiPropertyOptional({ description: 'SSH_KEY için PEM/OpenSSH özel anahtar. Güncellemede boş bırakılırsa mevcut sır korunur.' })
  @IsOptional()
  @IsString()
  @MaxLength(16384)
  privateKey?: string;

  @ApiPropertyOptional({ description: 'Özel anahtar parolası (varsa)' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  passphrase?: string;
}

export class ListSessionsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  serverId?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @toInt
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 25 })
  @IsOptional()
  @toInt
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 25;
}
