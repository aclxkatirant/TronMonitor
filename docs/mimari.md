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

Metrik tabloları (`MetricSample`, `DiskSample`, `NetworkInterfaceSample`) sunucu ve zaman damgasıyla bileşik birincil anahtar kullanır; uzun dönem grafikler için `MetricAggregate` tablosu 5 dakika / 1 saat / 1 gün çözünürlüklerinde özet tutar.

## Metrik geçmişi, özetleme ve saklama

- `GET /servers/:id/metrics?range=1h|6h|24h|7d|30d|custom` isteğin aralığına göre kaynak seçer: aralık ham saklama penceresi (varsayılan 7 gün) içindeyse ham örnekler `date_bin` ile ~360 noktaya özetlenir; dışındaysa sırasıyla 5 dakikalık, saatlik veya günlük `MetricAggregate` satırları okunur (örnek sayısıyla ağırlıklı ortalama). Hacim ve arayüz bazlı geçmiş yalnızca ham pencerede sunulur.
- Paylaşılan `MaintenanceService` (BullMQ `maintenance` kuyruğu, tek worker) üç işi çalıştırır: `agent-status-sweep` (30 sn), `metrics-aggregate` (5 dk: son 2 saatin 5 dakikalık özetleri, son 26 saatin saatlik özetleri ve son 3 günün günlük özetleri `ON CONFLICT DO UPDATE` ile yeniden hesaplanır; geç gelen tamponlanmış örnekler böylece dahil olur) ve `retention` (saatlik: ham örnekler, özetler, süresi dolmuş oturum ve kayıt belirteçleri temizlenir). Test ortamında zamanlayıcı başlatılmaz; işler doğrudan çağrılır.
- Saklama ve eşik ayarları `SystemSetting` tablosunda `monitoring` anahtarıyla tutulur (`GET/PUT /settings/monitoring`, `settings.read` / `settings.manage`). Varsayılanlar: ham 7 gün, 5 dk 30 gün, saatlik 365 gün, günlük 730 gün; eşikler CPU/bellek/disk %90, 3 ardışık örnek.
- Her metrik yığını alındıktan sonra eşikler son N ardışık örnek üzerinde değerlendirilir; aşım varsa sunucu `DEGRADED`, yoksa `ONLINE` olur ve `server.status` olayı yayınlanır. Olay (incident) üretimi Phase 5'te bu durum geçişine bağlanacaktır.
- Zaman damgaları UTC olarak `timestamp(3)` sütunlarında saklanır; saklama ve pencere sınırları JS tarafında UTC üretilir (`NOW()` oturum saat dilimine bağlı olduğundan kullanılmaz).
- Test ortamı Redis'in ayrı bir veritabanını (`TEST_REDIS_URL`, varsayılan `/1`) kullanır; e2e testleri `flushdb` yaptığından geliştirme kuyrukları ve zamanlayıcı kayıtları etkilenmez.

## Erişilebilirlik kontrolleri

- Kontroller `MonitoringCheck` tablosunda tutulur; `uptime-run` bakım işi 10 saniyede bir süresi gelenleri (`lastCheckedAt + intervalSec ≤ now`) seçer, önce `lastCheckedAt` ile talep eder (çift çalışmayı önler) ve en fazla 8 eşzamanlı çalıştırır. Kaçırılan çalıştırmalar bir sonraki taramada yakalanır.
- Çalıştırıcı (`check-runner.ts`): HTTP/HTTPS `fetch` ile (beklenen durum kodu veya 2xx/3xx), TCP `net.connect`, ICMP sistem `ping` komutu (yerelleştirilmiş çıktıyı da ayrıştırır). Başarısızlıkta `retryCount` kadar 1 sn arayla yeniden denenir; HTTPS'te sertifika bitişi ayrıca TLS el sıkışmasıyla okunur.
- Durum makinesi: `failureThreshold` ardışık başarısızlıkta `DOWN` (CHECK_DOWN olayı, kritik), `recoveryThreshold` ardışık başarıda `UP` (olay çözülür). SSL bitişine `sslExpiryWarnDays` gün kala SSL_EXPIRING olayı (3 gün ve altı kritik), yenilenince çözülür.
- Her çalıştırma `CheckResult` satırı üretir (30 gün saklanır). Geçmiş `date_bin` ile özetlenir; erişilebilirlik yüzdesi başarılı/toplam oranıdır.

## Olay yaşam döngüsü ve bildirimler

- `IncidentsService.open` aynı tür ve hedef için yalnızca bir etkin olay tutar (tekilleştirme); `resolveAuto` sistem tarafından, `resolveManual`/`acknowledge`/`addNote` kullanıcı tarafından çağrılır. Her adım `IncidentEvent` ve işlem kaydı üretir; `incident.created` / `incident.updated` WebSocket olayları yayınlanır.
- Kaynaklar: ajan taraması (AGENT_DISCONNECTED, kritik), heartbeat ile yeniden bağlanma (çözüm), eşik değerlendirmesi (HIGH_CPU / HIGH_MEMORY / LOW_DISK, uyarı; eşik altına inince çözüm), ajan iptali (bağlantı olayını kapatır), kontroller (CHECK_DOWN, SSL_EXPIRING).
- Bildirim kanalları `NotificationChannel` tablosunda AES-256-GCM ile şifreli yapılandırma tutar (AAD = kanal türü); okumada sırlar maskelenir, güncellemede boş bırakılan sır alanları korunur. Olay açıldığında türü, çözüldüğünde eşlenen toparlanma olayı (`notification-events.ts`) etkin kanallarla eşleştirilir; her gönderim `Notification` satırı olarak kuyruğa alınır ve `notifications` BullMQ kuyruğu 5 denemeye kadar üstel geri çekilmeyle teslim eder. Test ortamında kuyruk başlatılmaz; `deliverPending()` doğrudan çağrılır.

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

- **Hizmet raporu** (`/agents/services`, 60 sn): ajan tüm hizmetleri (`name`, `displayName`, `state`, `startupType`, `isEnabled`) gönderir; `MonitoredService` kayıtları yükseltilir, durum değişiklikleri `ServiceStateEvent` olarak yazılır, listede olmayan hizmetler `UNKNOWN` olur. İzlenen (`isMonitored`) bir hizmet `RUNNING` dışına çıkınca `SERVICE_FAILURE` olayı açılır, geri dönünce otomatik kapanır. Hizmet adı yalnızca yol ayırıcıları ve denetim karakterlerini reddeder (Windows adları boşluk içerebilir); ad hiçbir zaman kabuğa verilmez.
- **Komutlar**: `POST /servers/:id/services/:serviceId/control` (`services.control` izni) `AgentCommand` kaydı oluşturur (`service.start|stop|restart`, 10 dakika geçerli, aynı hizmet için bekleyen komut varsa `COMMAND_ALREADY_PENDING`). Bekleyen komutlar bir sonraki heartbeat yanıtında `commands` alanıyla ajana gider (`SENT`); ajan yalnızca beyaz listedeki komutları çalıştırır, sonucu `POST /agents/commands/:id/result` ile bildirir (`SUCCEEDED`/`FAILED`) ve ardından hizmet listesini yeniden raporlar. Süresi dolan komutlar `EXPIRED` olur. Her istek ve sonuç işlem kaydına yazılır.

- **Komut uzun yoklaması** (`GET /agents/commands/wait`): ajan sürekli bu uç noktayı çağırır; bekleyen komut yoksa istek en fazla 25 sn askıda kalır ve yeni komut Redis `agent:commands` kanalıyla yayınlanınca hemen döner. Böylece hizmet komutları ve terminal istekleri heartbeat aralığını beklemez.
- **Ajan terminal kanalı** (`WS /api/v1/agents/terminal?session=<id>`): `terminal.open` komutunu alan ajan bu adrese dışa doğru WebSocket açar; el sıkışma başlıkları normal isteklerle aynı HMAC imzasını taşır (yöntem `GET`, istek yolu sorgu dizesiyle birlikte, boş gövde). Kabuk çıktısı ikili çerçevelerle, denetim mesajları (`ready`, `resize`, `exit`, `error`) JSON ile taşınır.

## Sunucu yönetimi ve gerçek zamanlı kanal

- `GET /servers` listede sunucu başına en son metrik örneğini `DISTINCT ON` sorgusuyla getirir; disk yüzdesi son 1 saatteki hacim örneklerinin toplamından hesaplanır. Sıralama yalnızca sunucu sütunlarında yapılır (ad, durum, işletim sistemi, son heartbeat, kayıt tarihi).
- `PATCH /servers/:id` ad, açıklama, grup ve etiketleri; `PATCH /servers/:id/agent` toplama aralığını; `POST /servers/:id/agent/revoke` kimlik bilgisini iptal eder (ajan `REVOKED`, sunucu `OFFLINE`). `DELETE /servers/:id` sunucuyu tüm metrik ve olay geçmişiyle siler.
- Grup ve etiket adları veritabanı yerel ayarından bağımsız olarak Türkçe kurallarıyla (`toLocaleLowerCase('tr-TR')`) benzersizlik denetiminden geçer.
- `GET /agent-downloads/:file` yalnızca bilinen dosya adlarını (4 ikili, `SHA256SUMS`, 4 betik) sunar; ikili dosyalar özet dosyasında kayıtlı değilse sunulmaz. Dizinler `AGENT_RELEASES_DIR` ve `AGENT_SCRIPTS_DIR` ile değiştirilebilir.
- WebSocket ağ geçidi `/api/v1/ws` yolunda çalışır; bağlantı oturum çerezi ve `Origin` başlığıyla doğrulanır, `dashboard.read` izni gerekir ve kanal tek yönlüdür (sunucudan istemciye). Olaylar: `server.registered`, `server.updated`, `server.status`, `server.deleted`, `server.metrics`, `agent.revoked`, `incident.*`, `check.status`, `services.updated`. Arayüz olay geldiğinde ilgili sorguları geçersiz kılar; bağlantı yoksa 20 saniyelik yoklama sürer.

## API belirteçleri ve işlem kayıtları

- `POST /api-tokens` `tmk_` önekli 32 baytlık rastgele bir belirteç üretir; yalnızca SHA-256 karması ve ilk 12 karakteri saklanır, düz metin yalnızca yanıtla bir kez döner. Kapsamlar oluşturan kullanıcının etkin izinlerinin alt kümesi olmak zorundadır (`API_TOKEN_SCOPE_EXCEEDS`), isteğe bağlı bitiş tarihi verilir.
- `SessionAuthGuard` `Authorization: Bearer tmk_...` başlığını tanır; etkin izinler = sahibinin güncel izinleri ∩ belirteç kapsamı. Sahip devre dışıysa, belirteç iptal edilmiş veya süresi dolmuşsa istek reddedilir. Bearer isteklerinde CSRF başlığı aranmaz (çerez kullanılmaz). `lastUsedAt` en fazla dakikada bir güncellenir.
- `GET /api-tokens` kullanıcının kendi belirteçlerini, `?all=true` ile ve `apitokens.manage_all` izniyle tüm belirteçleri listeler; `DELETE /api-tokens/:id` iptal eder (yalnızca sahip veya `apitokens.manage_all`).
- `GET /audit-logs` (`audit.read`) işlem kayıtlarını arama, eylem, kullanıcı, kaynak türü, sonuç ve tarih aralığı filtreleriyle sayfalı döndürür; `GET /audit-logs/meta` filtre seçeneklerini verir. Kayıtlar için güncelleme/silme uç noktası yoktur.

## Web terminali

- Tarayıcı `WS /api/v1/terminal` kanalına oturum çerezi ile bağlanır (`terminal.use` izni, Origin denetimi; API belirteçleri WebSocket'te kabul edilmez). Her soket tek oturum taşır: `open {serverId, protocol?, cols, rows}` → `status`/`ready` → `input`/`resize` → `exit`. Kabuk çıktısı ikili çerçevelerle gelir.
- Yöntem seçimi: sunucuda SSH kimlik bilgisi varsa **SSH**, ajan bağlıysa **ajan kabuğu**; ikisi de varsa kullanıcı seçer. SSH, merkezden hedefe `ssh2` ile kurulur (PTY `xterm-256color`); ajan kabuğu, ajanın çalıştığı hesapla açılır (Windows'ta `LocalSystem`, ConPTY üzerinden PowerShell; Linux'ta PTY ile `$SHELL`). Bu nedenle `terminal.use` izni yönetici düzeyinde ayrıcalık sayılır ve varsayılan olarak yalnızca yöneticilerde bulunur.
- SSH kimlik bilgisi (`ServerCredential`): sunucu başına bir kayıt; parola veya özel anahtar JSON olarak AES-256-GCM ile (AAD = sunucu kimliği) şifrelenir, hiçbir uç noktadan geri okunmaz, yalnızca bağlantı kurulurken çözülür. Özel anahtar kaydedilmeden önce `ssh2` ile ayrıştırılır. Sunucu anahtarı parmak izi (`SHA256:…`) ilk başarılı bağlantıda kaydedilir (TOFU); sonraki bağlantılarda farklıysa bağlantı `TERMINAL_HOST_KEY_MISMATCH` ile reddedilir. Adres/port değişince parmak izi sıfırlanır.
- Oturum kaydı (`TerminalSession`): protokol, kullanıcı, istemci IP, başlangıç/bitiş, durum (`ACTIVE`, `CLOSED`, `FAILED`, `TIMED_OUT`, `TERMINATED`) ve kapanış nedeni. Yazılan komut satırları (`TerminalCommandLog`) tuş vuruşlarından çıkarılır (`command-parser.ts`: Enter satırı bitirir, Backspace/Ctrl+U/Ctrl+C düzenler, kaçış dizileri yok sayılır); kabuğun yankısı değil kullanıcının girdisi izlendiği için sezgiseldir. `terminal.open` / `terminal.close` / `terminal.terminate` işlem kaydına yazılır.
- Sınırlar: kullanıcı başına 3 eşzamanlı oturum, 15 dk boşta kalma, 4 saat azami süre, ajan bağlanması için 40 sn; ajan tarafında 5 eşzamanlı terminal ve `disableTerminal` yapılandırma anahtarı. Oturumlar API süreci belleğindedir; süreç yeniden başlayınca yarım kalan kayıtlar `TERMINATED` olarak işaretlenir.
- WinRM yolu uygulanmamıştır (`TerminalProtocol.WINRM` şemada ayrılmış durumdadır); Windows için ajan kabuğu kullanılır.

## Üretim dağıtımı

- Linux: `tronmonitor-api` ve `tronmonitor-web` systemd birimleri (`tronmonitor` sistem kullanıcısı, `ProtectSystem=strict`, `NoNewPrivileges`; API'ye ICMP için `AmbientCapabilities=CAP_NET_RAW`), `/etc/tronmonitor/api.env`, Nginx HTTPS ters vekili (`/api/` → 4000, WebSocket yükseltmesi ve uzun `proxy_read_timeout`; `/` → 3000). Betikler: `deploy/server/linux/{install,update,backup,restore,uninstall}.sh`.
- Windows: `TronMonitor API` ve `TronMonitor Web` Görev Zamanlayıcı görevleri (`LocalService`, açılışta başlar), `binun-service.ps1` sarmalayıcısı ortam dosyasını yükler, günlükleri yazar ve çökmede yeniden başlatır; node süreçleri `--title=TronMonitor-<rol>@<kurulum dizini>` imzasıyla bulunur. Ters vekil modu (`-PublicUrl`) ve basit mod (`http://<sunucu>:3000`, WebSocket doğrudan API portuna). Betikler: `deploy/server/windows/*.ps1`.
- Yedek arşivi: `pg_dump` özel biçim + `api.env` + `agent/dist`; geri yükleme `pg_restore --clean` ardından `prisma migrate deploy`. `DATABASE_URL` içindeki `?schema=` parametresi pg araçlarına verilmeden önce ayıklanır.
- `prisma generate`, `DATABASE_URL` tanımsızken yer tutucu adresle çalışır (temiz kurulumda `npm ci` sırasında); `migrate` için gerçek değer zorunludur.
- Ayrıntılar: [kurulum.md](kurulum.md), [isletim.md](isletim.md), [guvenlik.md](guvenlik.md), [uyumluluk.md](uyumluluk.md).
