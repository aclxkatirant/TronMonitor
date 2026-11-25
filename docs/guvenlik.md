# Güvenlik Modeli ve Gözden Geçirme

Bu belge TronMonitor'un güvenlik tasarımını, üretim öncesi yapılan kod incelemesinin sonuçlarını ve işletmecinin sorumluluğundaki önlemleri özetler. Mimari ayrıntılar için [mimari.md](mimari.md).

## Tasarım ilkeleri

- **Tüm yetkilendirme arka uçtadır.** Global `SessionAuthGuard` + `PermissionsGuard`; her uç nokta ya `@RequirePermissions(...)` ister ya da bilinçli olarak `@Public()` işaretlidir (giriş, kayıt, sağlık, ajan uçları, ajan indirmeleri). Arayüzdeki gizleme yalnızca kolaylıktır.
- **Nesne düzeyi sahiplik:** API belirteçleri, oturumlar ve terminal oturumları sahibine (ya da ilgili yönetim iznine) bağlıdır; hizmetler ve komutlar sunucu/ajan kimliğiyle eşleştirilir.
- **Sırlar hiçbir zaman geri okunmaz.** Parola karmaları (scrypt), oturum belirteci karmaları (HMAC-SHA256), API belirteci karmaları (SHA-256), ajan sırları, SSH kimlik bilgileri ve bildirim yapılandırmaları (AES-256-GCM, `ENCRYPTION_KEY`) hiçbir yanıt gövdesinde yer almaz; belirteçler yalnızca oluşturma anında bir kez gösterilir.
- **Oturumlar:** veritabanı tabanlı opak çerez (`tm_session`, HttpOnly, SameSite=Lax, üretimde Secure), 24 saat; parola değişince ve kullanıcı devre dışı kalınca tüm oturumlar ve açık WebSocket/terminal bağlantıları kapatılır.
- **CSRF:** çerezle yapılan tüm mutasyonlarda `X-Requested-With: XMLHttpRequest` zorunlu; CORS yalnızca `WEB_ORIGIN`.
- **API belirteçleri:** `tmk_` önekli, kapsamlı (sahibinin izinlerinin alt kümesi), süreli, iptal edilebilir; hesap yönetimi uçlarında (parola değişimi, oturum listesi/iptali, çıkış) kullanılamaz.
- **Ajan protokolü:** her istek HMAC-SHA256 imzalı (yöntem, yol+sorgu, zaman damgası, nonce, gövde özeti); ±300 sn zaman penceresi; nonce Redis'te 10 dk saklanır (yeniden oynatma koruması); kimlik bilgisi iptali anında geçerli olur; ajan terminal WebSocket'i aynı imzayla doğrulanır. Ajanlar yalnızca dışa doğru bağlanır.
- **Web terminali:** `terminal.use` izni yönetici düzeyinde ayrıcalıktır (ajan kabuğu ajan hesabıyla, Windows'ta LocalSystem ile çalışır). SSH sunucu anahtarı ilk bağlantıda öğrenilir ve sonra doğrulanır (uyuşmazlıkta bağlantı reddedilir). Oturumlar ve yazılan komut satırları işlem kaydına yazılır; 15 dk boşta kalma, 4 saat azami süre, kullanıcı başına 3 oturum.
- **Hız sınırları:** genel 120 istek/dk/IP; giriş, kayıt ve parola değişimi 5/dk; API belirteci oluşturma, SSH kimlik bilgisi kaydı, kontrol çalıştırma ve bildirim testi 20/dk; ajan kaydı 10/dk. Nginx tarafında giriş için ek sınır.
- **Girdi doğrulama:** class-validator ile tüm DTO'lar (`whitelist` + `forbidNonWhitelisted`), sayfa boyutları üst sınırlı, ham SQL yalnızca parametreli şablonlarla, hizmet adları ve kontrol hedefleri kısıtlı karakter kümesiyle; `ping` kabuk kullanmadan argüman dizisiyle çağrılır ve `-` ile başlayan hedef reddedilir.
- **Başlıklar:** Helmet, HSTS (Nginx), `X-Frame-Options: DENY`, `nosniff`, sıkı `Referrer-Policy`; Swagger yalnızca geliştirme ortamında.
- **İşlem kaydı:** kullanıcı, oturum, belirteç, sunucu, ajan, hizmet komutu, terminal, bildirim, kontrol, olay ve ayar işlemleri değiştirilemez kayıtlarla tutulur; 403 reddedilişleri kaydedilmez (bilinçli: gürültü).
- **Süreç dayanıklılığı:** WebSocket el sıkışmasındaki hatalar yakalanır; yakalanmayan Promise retleri günlüğe yazılır, süreç düşürülmez; systemd/Görev Zamanlayıcı çökmede yeniden başlatır.

## Üretim öncesi inceleme (2026-11-25)

API kaynak kodu üzerinde salt okunur bir savunma amaçlı inceleme yapıldı (yetkilendirme kapsamı, nesne sahipliği, girdi doğrulama, sır ifşası, ajan protokolü, WebSocket kanalları, hız sınırları, işlem kaydı). Bulgular ve yapılanlar:

| Önem | Bulgu | Durum |
| --- | --- | --- |
| Yüksek | Bozuk yüzde kodlamalı çerezle WebSocket el sıkışması yakalanmayan Promise reddi üretip süreci düşürebiliyordu | Düzeltildi: güvenli çerez ayrıştırma, gateway'lerde try/catch, `unhandledRejection` güvenlik ağı; e2e testi eklendi |
| Yüksek | `users.manage` sahibi, kendi sahip olmadığı izinleri alt rol kullanıcılara verebiliyordu | Düzeltildi: verilen izinler aktörün etkin izin kümesinin alt kümesi olmalı (`USER_PERMISSION_EXCEEDS`); e2e testi eklendi |
| Orta | Kapsamlı API belirteci parola değiştirebiliyor ve oturumları yönetebiliyordu | Düzeltildi: hesap yönetimi uçları yalnızca tarayıcı oturumuyla (`AUTH_SESSION_REQUIRED`); e2e testi eklendi |
| Orta | Oturum iptali/kullanıcı devre dışı bırakma açık WebSocket ve terminal oturumlarını kapatmıyordu | Düzeltildi: oturum iptal olayları pano ve terminal kanallarına yayılıyor; e2e testi eklendi |
| Düşük | ICMP hedefi `-` ile başlayınca `ping` seçeneği olarak yorumlanıyordu | Düzeltildi: hedef `-` ile başlayamaz |
| Düşük | WebSocket tarafında `X-Forwarded-For` koşulsuz güveniliyordu | Düzeltildi: yalnızca yerel ters vekilden kabul (HTTP ile aynı politika) |
| Düşük | Hassas mutasyonlarda yalnızca genel hız sınırı vardı | Düzeltildi: parola değişimi 5/dk; belirteç, kimlik bilgisi, kontrol çalıştırma ve bildirim testi 20/dk |
| Düşük | Erişilebilirlik kontrolleri iç ağ adreslerine ulaşabilir (kör SSRF / port keşfi) | Bilinçli kabul: kontroller yöneticinin kendi altyapısı içindir ve `uptime.manage` izni gerektirir; `run` ucu hız sınırlandı. İç ağ ayrımı gerekiyorsa API'yi ayrı bir ağ bölümünde çalıştırın |
| Bilgi | Ajan imzasında gövde özeti UTF-8 yeniden kodlamasıyla hesaplanıyor | Değiştirilmedi: geçerli UTF-8 için Go ajanıyla aynı özet; geçersiz baytlar zaten reddedilir |

Sorun bulunmayan alanlar: tüm rotaların izin kapsamı, nesne sahipliği denetimleri, DTO doğrulama ve parametreli SQL, yanıtlarda sır bulunmaması, ajan imza/nonce/iptal mantığı, WebSocket Origin ve izin denetimi, ajan dosya indirmelerinde yol geçişi koruması, işlem kaydı kapsamı, hata filtresinin 5xx ayrıntılarını gizlemesi.

## İşletmecinin sorumlulukları

- HTTPS kullanın; `WEB_ORIGIN` gerçek adresle eşleşmeli, `COOKIE_SECURE` açık kalmalı. HTTP yalnızca kapalı iç ağ için.
- `api.env` ve özellikle `ENCRYPTION_KEY` için erişimi kısıtlayın ve güvenli yedek tutun; anahtar kaybolursa şifreli sırlar kurtarılamaz.
- PostgreSQL ve Redis'i yalnızca 127.0.0.1 (ya da özel ağ) üzerinde dinletin; Redis'e parola koymak isterseniz `REDIS_URL` içinde belirtin.
- `terminal.use` ve `terminal.credentials` izinlerini yalnızca gerçekten ihtiyaç duyan yöneticilere verin; ajan kabuğunun ajan hesabıyla (Windows'ta LocalSystem) çalıştığını unutmayın. Gerekmeyen ajanlarda `disableTerminal` ayarını kullanın.
- Ajan kayıt belirteçlerini kısa ömürlü tutun; artık kullanılmayan sunucuların ajan kimlik bilgilerini iptal edin.
- İşlem kayıtlarını ve terminal oturum geçmişini düzenli gözden geçirin; yedekleri ayrı bir makinede şifreli saklayın.
- Bağımlılıkları güncel tutun: `npm audit` ve Go modülleri; güncelleme betikleri `npm ci` ile kilit dosyasını kullanır.

## Bildirim

Güvenlik açığı bulduysanız herkese açık bir issue açmak yerine depo sahibine özel olarak ulaşın.
