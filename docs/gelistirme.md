# Geliştirme Ortamı Kurulumu

## Gereksinimler

- Node.js 20 veya üzeri (geliştirme Node 24 ile yapılmaktadır)
- PostgreSQL 15 veya üzeri
- Redis 6 veya üzeri. Windows'ta resmi Redis bulunmadığından Redis uyumlu **Memurai Developer** kullanılır.
- Git

## Veritabanı hazırlığı

Uygulama kullanıcısı ve iki veritabanı (geliştirme ve test) oluşturun:

```sql
CREATE ROLE tronmonitor LOGIN PASSWORD 'guclu-bir-parola';
CREATE DATABASE tronmonitor OWNER tronmonitor ENCODING 'UTF8';
CREATE DATABASE tronmonitor_test OWNER tronmonitor ENCODING 'UTF8';
-- Yalnızca geliştirme: Prisma Migrate'in gölge veritabanı oluşturabilmesi için
ALTER ROLE tronmonitor CREATEDB;
```

Üretimde `CREATEDB` yetkisi gerekmez; göçler `prisma migrate deploy` ile uygulanır.

## Ortam değişkenleri

`apps/api/.env.example` dosyasını `apps/api/.env` olarak kopyalayın ve doldurun. Rastgele sırlar üretmek için:

```bash
node -e "console.log('SESSION_SECRET=' + require('crypto').randomBytes(48).toString('base64url'))"
node -e "console.log('ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('base64'))"
```

`TEST_DATABASE_URL` yalnızca uçtan uca testler için gereklidir ve adı `_test` ile biten bir veritabanına işaret etmelidir; test kurulumu bunu zorunlu kılar.

## Kurulum ve çalıştırma

```bash
npm install
npm run prisma:generate
npx prisma migrate dev --name init   # apps/api dizininde; geliştirme veritabanına göçleri uygular
npm run dev:api                      # API: http://127.0.0.1:4000/api/v1  Swagger: http://127.0.0.1:4000/api/docs
npm run dev:web                      # Arayüz: http://localhost:3000
```

İlk açılışta arayüz sizi `/kurulum` sayfasına yönlendirir; burada oluşturulan ilk hesap süper yönetici olur.

İsteğe bağlı olarak `BOOTSTRAP_ADMIN_EMAIL` ve `BOOTSTRAP_ADMIN_PASSWORD` değişkenleriyle ilk yönetici API açılışında otomatik oluşturulabilir (yalnızca veritabanında hiç kullanıcı yokken çalışır).

## Doğrulama komutları

```bash
npm run typecheck                         # her iki uygulama
npm run lint
npm run build
npm run test --workspace apps/api         # birim testleri
npm run test:e2e --workspace apps/api     # uçtan uca testler (PostgreSQL + Redis çalışıyor olmalı)
```

## Kod kuralları

- Kaynak kod tanımlayıcıları (değişken, fonksiyon, alan, uç nokta) İngilizce; kullanıcıya görünen tüm metinler Türkçe.
- Kullanıcıya dönen hata mesajları `apps/api/src/common/messages.ts` dosyasında merkezi olarak tanımlanır.
- Yeni izinler `apps/api/src/permissions/permission-catalog.ts` dosyasına eklenir; açılışta veritabanıyla eşitlenir.
- Her değiştirici işlem `AuditService.record` ile işlem kaydı üretmelidir.
- Her özellik için birim ve/veya uçtan uca test yazılır; testler geçmeden özellik tamamlanmış sayılmaz.
