import { randomBytes } from 'node:crypto';
import { EncryptionService } from './encryption.service';
import type { AppConfigService } from '../config/config.service';

function makeService(key = randomBytes(32)): EncryptionService {
  return new EncryptionService({ encryptionKey: key } as unknown as AppConfigService);
}

describe('EncryptionService', () => {
  it('şifreler ve çözer', () => {
    const service = makeService();
    const payload = service.encrypt('çok gizli değer');
    expect(payload.startsWith('v1:')).toBe(true);
    expect(payload).not.toContain('gizli');
    expect(service.decrypt(payload)).toBe('çok gizli değer');
  });

  it('aynı düz metin için farklı çıktı üretir (rastgele IV)', () => {
    const service = makeService();
    expect(service.encrypt('a')).not.toBe(service.encrypt('a'));
  });

  it('farklı anahtar veya AAD ile çözülemez', () => {
    const service = makeService();
    const other = makeService();
    const payload = service.encrypt('deger', 'tma_1');
    expect(() => other.decrypt(payload, 'tma_1')).toThrow();
    expect(() => service.decrypt(payload, 'tma_2')).toThrow();
    expect(service.decrypt(payload, 'tma_1')).toBe('deger');
  });

  it('bozuk veriyi reddeder', () => {
    const service = makeService();
    expect(() => service.decrypt('v9:abc')).toThrow();
    expect(() => service.decrypt('v1:AAAA')).toThrow();
    const payload = service.encrypt('deger');
    const raw = Buffer.from(payload.slice(3), 'base64');
    raw[20] ^= 0xff;
    const tampered = `v1:${raw.toString('base64')}`;
    expect(() => service.decrypt(tampered)).toThrow();
  });
});
