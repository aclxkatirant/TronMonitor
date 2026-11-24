import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from './env.schema';

/**
 * Doğrulanmış ortam değişkenlerine tip güvenli erişim sağlar.
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  get<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true });
  }

  get isProduction(): boolean {
    return this.get('NODE_ENV') === 'production';
  }

  get isTest(): boolean {
    return this.get('NODE_ENV') === 'test';
  }

  get databaseUrl(): string {
    if (this.isTest) {
      const testUrl = this.get('TEST_DATABASE_URL');
      if (testUrl) return testUrl;
    }
    return this.get('DATABASE_URL');
  }

  get encryptionKey(): Buffer {
    return Buffer.from(this.get('ENCRYPTION_KEY'), 'base64');
  }

  get sessionTtlMs(): number {
    return this.get('SESSION_TTL_HOURS') * 60 * 60 * 1000;
  }
}
