# TronMonitor Mimarisi

Bu belge, TronMonitor'un bileşenlerini, aralarındaki iletişimi ve temel tasarım kararlarını açıklar. Henüz uygulanmamış bileşenler açıkça belirtilmiştir.

## Bileşenler

| Bileşen | Teknoloji | Durum |
| --- | --- | --- |
| Web arayüzü | Next.js (App Router), Tailwind, shadcn/ui | Kimlik doğrulama ve kullanıcı yönetimi hazır |
| Merkezi API | NestJS, Prisma, PostgreSQL | Kimlik doğrulama, yetkilendirme, kullanıcılar, işlem kayıtları hazır |
| Kuyruk / önbellek | Redis + BullMQ | Bağlantı hazır; işler henüz tanımlı değil |
| İzleme ajanı | Go | Henüz uygulanmadı |
| Bildirim sistemi | Discord / Telegram / E-posta | Henüz uygulanmadı |
| Terminal yönetimi | SSH / WinRM | Henüz uygulanmadı |

## Depo yapısı

```
apps/api      NestJS arka uç (REST API, WebSocket, zamanlanmış işler)
apps/web      Next.js web arayüzü
agent         Go izleme ajanı (planlandı)
deploy/linux  Linux kurulum betikleri, systemd ve Nginx yapılandırmaları (planlandı)
deploy/windows Windows kurulum betikleri ve hizmet yapılandırması (planlandı)
docs          Türkçe belgeler
```

Depo bir npm çalışma alanıdır (workspaces); bağımlılıklar kök dizinde tek `package-lock.json` ile yönetilir.

## İstek akışı

1. Tarayıcı, Next.js arayüzüne bağlanır.
2. Arayüz tüm API çağrılarını aynı kökenden `/api/v1/...` yoluna yapar. Geliştirmede Next.js bu yolu arka uca yönlendirir; üretimde ters vekil (Nginx) aynı işi üstlenir. Böylece oturum çerezi CORS'a gerek kalmadan çalışır.
3. Arka uç her istekte oturum çerezini doğrular, kullanıcının etkin izinlerini hesaplar ve uç noktanın gerektirdiği izinleri denetler.

## Kimlik doğrulama ve oturumlar

- Parolalar `scrypt` (N=2^16, r=8, p=2) ile karmalanır; Unicode NFKC normalizasyonu uygulanır.
- Oturum belirteci 32 baytlık rastgele bir değerdir. Veritabanında yalnızca `HMAC-SHA256(SESSION_SECRET, belirteç)` saklanır; çerezde ham belirteç taşınır.
- Çerez: `tm_session`, `HttpOnly`, `SameSite=Lax`, üretimde `Secure`.
- CSRF: çerezle kimlik doğrulanan `POST/PUT/PATCH/DELETE` isteklerinde `X-Requested-With: XMLHttpRequest` başlığı zorunludur. Tarayıcılar çapraz kökenli basit isteklerde bu başlığı gönderemez; CORS ön kontrolü yabancı kökenleri engeller.
- Giriş ve kayıt uç noktaları IP başına dakikada 5 denemeyle sınırlıdır; genel sınır dakikada 120 istektir.
- Parola değişikliğinde diğer oturumlar kapatılır. Hesap devre dışı bırakıldığında tüm oturumlar anında geçersiz olur (her istekte `isActive` denetlenir).

## Yetkilendirme modeli

- Roller: `SUPER_ADMIN`, `ADMIN`, `OPERATOR`, `VIEWER`.
- İzinler `Permission` tablosunda, rol varsayılanları `RolePermission` tablosunda tutulur. Uygulama açılışında kod içindeki katalog (`apps/api/src/permissions/permission-catalog.ts`) veritabanıyla eşitlenir; rol varsayılanları yalnızca rolün hiç kaydı yoksa yazılır.
- Etkin izinler = rol izinleri ∪ kullanıcıya özel izinler (`UserPermission`).
- Sunucu düzeyinde kısıtlamalar için `ServerPermission` tablosu hazırdır; sunucu modülüyle birlikte devreye alınacaktır.
- Yönetici (`ADMIN`) yalnızca kendinden düşük seviyedeki rolleri yönetebilir; kimse kendi rolünü ya da hesap durumunu değiştiremez.

## Veritabanı

Şema `apps/api/prisma/schema.prisma` dosyasındadır ve Prisma Migrate ile yönetilir. Tüm ürün modelleri (sunucular, ajanlar, metrikler, kontroller, olaylar, bildirimler, terminal, işlem kayıtları) ilk göçte tanımlanmıştır; ilgili modüller geliştirildikçe tablolar kullanılmaya başlanır.

Metrik tabloları (`MetricSample`, `DiskSample`, `NetworkInterfaceSample`) sunucu ve zaman damgasıyla bileşik birincil anahtar kullanır; uzun dönem grafikler için `MetricAggregate` tablosu 5 dakika / 1 saat / 1 gün çözünürlüklerinde özet tutar. Saklama politikası arka plan işleriyle uygulanacaktır.

## Hata biçimi

Tüm hatalar aynı gövdeyle döner:

```json
{ "statusCode": 403, "code": "AUTH_FORBIDDEN", "message": "Bu işlemi gerçekleştirmek için yetkiniz yok." }
```

`code` programatik eşleme, `message` kullanıcıya gösterim içindir. Doğrulama hatalarında `details` alanı alan bazlı Türkçe mesajları içerir.

## Planlanan ajan iletişimi

Ajanlar yalnızca dışa doğru HTTPS/WSS bağlantısı kurar; sunucularda ek port açılmaz. Her ajanın benzersiz bir kimliği ve karması saklanan bir sırrı olur (`AgentCredential`). Kayıt, kısa ömürlü ve tek kullanımlık belirteçlerle (`RegistrationToken`) yapılır. Terminal erişimi ajanın telemetri kanalından ayrı tutulur.
