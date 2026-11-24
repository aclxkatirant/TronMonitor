import { constantTimeEquals, generateToken, hashPassword, hmacToken, verifyPassword } from './crypto';

describe('crypto', () => {
  it('parolayı karmalar ve doğrular', async () => {
    const hash = await hashPassword('GizliParola123');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(hash.split('$')).toHaveLength(6);
    await expect(verifyPassword('GizliParola123', hash)).resolves.toBe(true);
    await expect(verifyPassword('gizliparola123', hash)).resolves.toBe(false);
  });

  it('aynı parola için farklı tuz üretir', async () => {
    const a = await hashPassword('AyniParola1234');
    const b = await hashPassword('AyniParola1234');
    expect(a).not.toEqual(b);
  });

  it('bozuk karma biçimini reddeder', async () => {
    await expect(verifyPassword('x', 'bcrypt$abc')).resolves.toBe(false);
    await expect(verifyPassword('x', '')).resolves.toBe(false);
    await expect(verifyPassword('x', 'scrypt$a$b$c$d$e')).resolves.toBe(false);
  });

  it('Unicode normalizasyonu uygular', async () => {
    const hash = await hashPassword('şifreÅ1234'); // A + halka
    await expect(verifyPassword('şifreÅ1234', hash)).resolves.toBe(true); // Å
  });

  it('rastgele belirteç üretir', () => {
    const t1 = generateToken();
    const t2 = generateToken();
    expect(t1).not.toEqual(t2);
    expect(t1.length).toBeGreaterThanOrEqual(43);
    expect(/^[A-Za-z0-9_-]+$/.test(t1)).toBe(true);
  });

  it('HMAC belirteç karması deterministiktir ve sırra bağlıdır', () => {
    expect(hmacToken('abc', 'secret-1')).toEqual(hmacToken('abc', 'secret-1'));
    expect(hmacToken('abc', 'secret-1')).not.toEqual(hmacToken('abc', 'secret-2'));
  });

  it('sabit zamanlı karşılaştırma yapar', () => {
    expect(constantTimeEquals('abc', 'abc')).toBe(true);
    expect(constantTimeEquals('abc', 'abd')).toBe(false);
    expect(constantTimeEquals('abc', 'abcd')).toBe(false);
  });
});
