import { z } from 'zod';

const booleanString = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((value) => value === true || value === 'true' || value === '1');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  API_HOST: z.string().min(1).default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL zorunludur'),
  TEST_DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().min(1).default('redis://127.0.0.1:6379'),
  TEST_REDIS_URL: z.string().optional().or(z.literal('')),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET en az 32 karakter olmalıdır'),
  ENCRYPTION_KEY: z
    .string()
    .min(1, 'ENCRYPTION_KEY zorunludur')
    .refine((value) => Buffer.from(value, 'base64').length === 32, {
      message: 'ENCRYPTION_KEY base64 kodlanmış 32 baytlık bir anahtar olmalıdır',
    }),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 90).default(24),
  // Üretimde varsayılan olarak açık; yalnızca açıkça false verilirse kapanır (HTTPS olmayan iç ağ kurulumları).
  COOKIE_SECURE: booleanString.optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  AGENT_RELEASES_DIR: z.string().optional().or(z.literal('')),
  AGENT_SCRIPTS_DIR: z.string().optional().or(z.literal('')),
  BOOTSTRAP_ADMIN_EMAIL: z.string().email().optional().or(z.literal('')),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().optional().or(z.literal('')),
});

export type Env = Omit<z.infer<typeof envSchema>, 'COOKIE_SECURE'> & { COOKIE_SECURE: boolean };

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(kök)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Ortam değişkenleri geçersiz:\n${details}`);
  }
  const env = result.data;
  const isProduction = env.NODE_ENV === 'production';
  if (isProduction && env.WEB_ORIGIN.startsWith('http://') && env.COOKIE_SECURE !== false) {
    throw new Error('Üretimde WEB_ORIGIN http:// ise COOKIE_SECURE=false açıkça verilmelidir (HTTPS olmadan güvenli çerez gönderilemez); HTTPS kullanmanız önerilir.');
  }
  return { ...env, COOKIE_SECURE: env.COOKIE_SECURE ?? isProduction };
}
