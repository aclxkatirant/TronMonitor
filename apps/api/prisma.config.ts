import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // `prisma generate` veritabanına bağlanmaz; DATABASE_URL tanımsızken (ör. temiz kurulumda npm ci) üretim
    // kurulumunun çökmemesi için yer tutucu kullanılır. migrate/studio için gerçek değer zorunludur.
    url: process.env.DATABASE_URL ?? 'postgresql://tronmonitor@127.0.0.1:5432/tronmonitor',
  },
});
