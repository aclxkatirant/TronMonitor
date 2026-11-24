import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AppConfigService } from '../config/config.service';

const VERSION = 'v1';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/**
 * Uygulama sırlarını (ajan anahtarları, bildirim yapılandırmaları, terminal kimlik bilgileri) veritabanında
 * AES-256-GCM ile şifreler. Biçim: v1:<base64(iv | tag | ciphertext)>
 */
@Injectable()
export class EncryptionService {
  private readonly key: Buffer;

  constructor(config: AppConfigService) {
    this.key = config.encryptionKey;
  }

  encrypt(plaintext: string, aad?: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    if (aad) cipher.setAAD(Buffer.from(aad));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${VERSION}:${Buffer.concat([iv, tag, ciphertext]).toString('base64')}`;
  }

  decrypt(payload: string, aad?: string): string {
    const [version, data] = payload.split(':');
    if (version !== VERSION || !data) throw new Error('Desteklenmeyen şifreli veri biçimi');
    const buffer = Buffer.from(data, 'base64');
    if (buffer.length < IV_LENGTH + TAG_LENGTH) throw new Error('Şifreli veri bozuk');
    const iv = buffer.subarray(0, IV_LENGTH);
    const tag = buffer.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const ciphertext = buffer.subarray(IV_LENGTH + TAG_LENGTH);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    if (aad) decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }
}
