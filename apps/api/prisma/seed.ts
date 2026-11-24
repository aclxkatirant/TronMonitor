import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, UserRole } from '../src/generated/prisma/client';
import { ALL_PERMISSIONS, PERMISSION_DESCRIPTIONS, ROLE_DEFAULT_PERMISSIONS } from '../src/permissions/permission-catalog';

/**
 * İzin kataloğunu ve rol varsayılanlarını veritabanına yazar. Uygulama açılışında da aynı eşitleme yapılır;
 * bu betik kurulum sırasında uygulamayı başlatmadan tabloları doldurmak için kullanılır.
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL tanımlı değil');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  try {
    for (const key of ALL_PERMISSIONS) {
      await prisma.permission.upsert({
        where: { key },
        create: { key, description: PERMISSION_DESCRIPTIONS[key] },
        update: { description: PERMISSION_DESCRIPTIONS[key] },
      });
    }
    for (const role of Object.values(UserRole)) {
      const existing = await prisma.rolePermission.count({ where: { role } });
      if (existing === 0) {
        await prisma.rolePermission.createMany({
          data: ROLE_DEFAULT_PERMISSIONS[role].map((permissionKey) => ({ role, permissionKey })),
          skipDuplicates: true,
        });
      }
    }
    console.log(`İzin kataloğu eşitlendi: ${ALL_PERMISSIONS.length} izin, ${Object.keys(UserRole).length} rol.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('Tohumlama başarısız:', error);
  process.exit(1);
});
