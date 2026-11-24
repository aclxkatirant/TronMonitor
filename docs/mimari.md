# TronMonitor Mimarisi

Bu belge, TronMonitor'un bileşenlerini, aralarındaki iletişimi ve temel tasarım kararlarını açıklar. Henüz uygulanmamış bileşenler açıkça belirtilmiştir.

## Bileşenler

| Bileşen | Teknoloji | Durum |
| --- | --- | --- |
| Web arayüzü | Next.js (App Router), Tailwind, shadcn/ui | Kimlik doğrulama ve kullanıcı yönetimi hazır |
| Merkezi API | NestJS, Prisma, PostgreSQL | Kimlik doğrulama, yetkilendirme, kullanıcılar, işlem kayıtları hazır |
| Kuyruk / önbellek | Redis + BullMQ | Çevrimdışı ajan taraması 30 saniyede bir çalışır |
| İzleme ajanı | Go | Kayıt, heartbeat, metrikler, Windows hizmeti ve systemd hazır (bkz. docs/ajan) |
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

## Ajan iletişimi

Ajanlar yalnızca dışa doğru HTTPS bağlantısı kurar; izlenen sunucularda ek port açılmaz.

- **Kayıt**: `POST /api/v1/agents/register` kısa ömürlü, tek kullanımlık `tmr_` belirtecini (`RegistrationToken`, SHA-256 karması saklanır) ajan kimlik bilgisiyle takas eder. Sunucu, ajan ve kimlik bilgisi tek veritabanı işleminde oluşturulur; belirteç aynı işlemde "kullanıldı" olarak işaretlenir.
- **Kimlik bilgisi**: `tma_` anahtar kimliği ve 32 baytlık gizli anahtar. Gizli anahtar merkezde AES-256-GCM ile (`ENCRYPTION_KEY`, AAD = keyId) şifrelenmiş saklanır (`AgentCredential.secretEncrypted`).
- **İmzalama**: her istek `X-Agent-Key`, `X-Agent-Timestamp`, `X-Agent-Nonce`, `X-Agent-Signature` başlıklarıyla gelir. İmza = HMAC-SHA256(secret, `METHOD\nrequestUri\ntimestamp\nnonce\nsha256hex(body)`). Zaman damgası ±300 saniye içinde olmalı; nonce Redis'te 10 dakika tutulur ve ikinci kullanım `AGENT_REPLAY_DETECTED` ile reddedilir. Doğrulama `AgentAuthGuard` içinde ham istek gövdesi üzerinden yapılır (`rawBody: true`).
- **Heartbeat** (`/agents/heartbeat`, 30 sn): sürüm ve sistem bilgisi güncellenir, sunucu `ONLINE` olur, yeniden bağlanma ve sürüm değişikliği `AgentConnectionEvent` olarak kaydedilir. Yanıt toplama aralığını taşır.
- **Metrikler** (`/agents/metrics`): en fazla 120 örneklik yığın; 24 saatten eski veya 5 dakikadan ileri zaman damgaları reddedilir; çift örnekler birincil anahtar sayesinde atlanır.
- **Çevrimdışı tespiti**: BullMQ `maintenance` kuyruğundaki `agent-status-sweep` işi 30 saniyede bir çalışır; 90 saniye heartbeat almayan sunucular `OFFLINE`, ajanları `DISCONNECTED` olarak işaretlenir ve `DISCONNECTED` olayı yazılır.
- **İptal**: kimlik bilgisi `REVOKED` yapıldığında ajan `AGENT_CREDENTIAL_REVOKED` alır ve veri göndermeyi durdurur.

Terminal erişimi bu telemetri kanalından ayrı tutulacaktır (Phase 6).

## Sunucu yönetimi ve gerçek zamanlı kanal

- `GET /servers` listede sunucu başına en son metrik örneğini `DISTINCT ON` sorgusuyla getirir; disk yüzdesi son 1 saatteki hacim örneklerinin toplamından hesaplanır. Sıralama yalnızca sunucu sütunlarında yapılır (ad, durum, işletim sistemi, son heartbeat, kayıt tarihi).
- `PATCH /servers/:id` ad, açıklama, grup ve etiketleri; `PATCH /servers/:id/agent` toplama aralığını; `POST /servers/:id/agent/revoke` kimlik bilgisini iptal eder (ajan `REVOKED`, sunucu `OFFLINE`). `DELETE /servers/:id` sunucuyu tüm metrik ve olay geçmişiyle siler.
- Grup ve etiket adları veritabanı yerel ayarından bağımsız olarak Türkçe kurallarıyla (`toLocaleLowerCase('tr-TR')`) benzersizlik denetiminden geçer.
- `GET /agent-downloads/:file` yalnızca bilinen dosya adlarını (4 ikili, `SHA256SUMS`, 4 betik) sunar; ikili dosyalar özet dosyasında kayıtlı değilse sunulmaz. Dizinler `AGENT_RELEASES_DIR` ve `AGENT_SCRIPTS_DIR` ile değiştirilebilir.
- WebSocket ağ geçidi `/api/v1/ws` yolunda çalışır; bağlantı oturum çerezi ve `Origin` başlığıyla doğrulanır, `dashboard.read` izni gerekir ve kanal tek yönlüdür (sunucudan istemciye). Olaylar: `server.registered`, `server.updated`, `server.status`, `server.deleted`, `server.metrics`, `agent.revoked`. Arayüz olay geldiğinde ilgili sorguları geçersiz kılar; bağlantı yoksa 20 saniyelik yoklama sürer.
