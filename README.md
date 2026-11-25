# TronMonitor

**Tüm altyapınız, tek merkezde.**

TronMonitor; Windows Server ve Linux sunucularınızı tek bir web panosundan izlemenizi, yönetmenizi ve denetlemenizi sağlayan, çapraz platform bir altyapı yönetim platformudur.

> Durum: Erken geliştirme aşaması. Aşağıdaki "Uygulanan özellikler" bölümü yalnızca bu depoda gerçekten çalışan ve test edilen yetenekleri listeler.

## Uygulanan özellikler

- Kimlik doğrulama: ilk kurulumda süper yönetici oluşturma, e-posta/parola ile giriş, güvenli oturum çerezleri, parola değiştirme, etkin oturumları görüntüleme ve sonlandırma
- Rol tabanlı yetkilendirme: Süper Yönetici, Yönetici, Operatör, İzleyici rolleri; ayrıntılı izin kataloğu; kullanıcı bazında ek izin atama
- Kullanıcı yönetimi: kullanıcı listeleme, arama, filtreleme, oluşturma, düzenleme, devre dışı bırakma, parola sıfırlama
- İşlem kayıtları: giriş, çıkış, kayıt, parola, kullanıcı, sunucu, kontrol, olay, bildirim, hizmet ve belirteç işlemleri değiştirilemez biçimde kaydedilir; **İşlem Kayıtları** sayfasında arama, eylem/sonuç/kaynak filtreleri, sayfalama ve ayrıntı görünümü
- Güvenlik temelleri: scrypt parola karması, HMAC ile karmalanmış oturum belirteçleri, CSRF koruması, giriş hız sınırı, Helmet başlıkları, sıkı girdi doğrulama
- Web arayüzü: koyu temalı, Türkçe, duyarlı pano kabuğu; giriş, kurulum, genel bakış, hesap ayarları ve kullanıcı yönetimi sayfaları
- İzleme ajanı (Go): Windows ve Linux için yerel ikili dosyalar; kayıt belirteciyle kayıt, HMAC imzalı ve yeniden oynatmaya karşı korumalı iletişim, heartbeat, CPU/bellek/disk/ağ metrikleri, kesintide tamponlama, Windows hizmeti ve systemd entegrasyonu
- Ajan API'si: kayıt belirteçleri (oluşturma, listeleme, iptal), ajan kaydı, heartbeat, metrik alımı, çevrimdışı tespiti (BullMQ zamanlayıcı)
- Sunucu yönetimi: sunucu listesi (arama, işletim sistemi/durum/grup/etiket filtreleri, son CPU/bellek/disk kullanımı), üç adımlı sunucu ekleme sihirbazı (platform → bilgiler → tek satır kurulum komutu, kayıt tamamlanınca canlı bildirim), sunucu ayrıntı sayfası (sistem bilgisi, kullanım, disk hacimleri, ağ arayüzleri, ajan bilgisi, bağlantı geçmişi), düzenleme, silme, ajan erişimini iptal etme, toplama aralığı ayarı, gruplar ve etiketler
- Ajan dağıtımı: ikili dosyalar ve kurulum betikleri API üzerinden sunulur; `install-agent.sh` / `install-agent.ps1` indirir, SHA-256 özetini doğrular, kaydeder ve hizmeti kurar
- Gerçek zamanlı pano: WebSocket (`/api/v1/ws`) ile sunucu durumu ve metrik olayları anında yansır; bağlantı yoksa düzenli yoklama devreye girer
- Genel bakış: toplam/çevrimiçi/çevrimdışı sunucu sayıları, erişilebilirlik yüzdesi, ortalama CPU/bellek/disk kullanımı, son ajan olayları
- İzleme ve geçmiş metrikler: son 1 saat / 6 saat / 24 saat / 7 gün / 30 gün ve özel aralık; CPU, bellek, ağ, disk doluluğu, disk G/Ç, yük ortalaması (Linux), hacim ve arayüz bazında grafikler (Recharts, tablo görünümü ve çapraz imleçli ipucu ile); en yoğun sunucular tablosu; sunucu başına metrik sayfası
- Veri saklama ve özetleme: ham örnekler → 5 dakikalık → saatlik → günlük özetler (BullMQ bakım işleri), ayarlanabilir saklama süreleri, uzun aralıklar özet tablolarından okunur
- Eşikler: CPU / bellek / disk eşikleri ardışık örneklerde aşılınca sunucu "sorunlu" olur ve toparlanınca normale döner; Ayarlar sayfasından yönetilir
- Erişilebilirlik kontrolleri: HTTP, HTTPS, TCP ve ICMP (ping) kontrolleri; yeniden deneme, hata/toparlanma eşikleri, SSL sertifika bitiş takibi; yanıt süresi ve erişilebilirlik grafikleri; 24 saat / 7 gün / 30 gün erişilebilirlik yüzdeleri; süre tabanlı güvenilir zamanlayıcı
- Olay yönetimi: ajan kopması, kontrol kesintisi, kaynak eşiği aşımı ve SSL bitişi için otomatik olay açma ve çözme; üstlenme, not ekleme, elle çözme; zaman çizelgesi ve bildirim geçmişi
- Bildirimler: Discord webhook, Telegram bot ve SMTP e-posta kanalları; olay türüne göre seçim, test gönderimi, şifreli ve maskelenmiş yapılandırma, kuyruklu ve yeniden denemeli teslim
- Hizmet izleme ve yönetimi: ajan Windows hizmetlerini ve systemd birimlerini her 60 saniyede raporlar; hizmet listesi (arama, durum ve izleme filtreleri), izlemeye alınan hizmet durduğunda kritik olay açılır ve toparlanınca kapanır; yetkili kullanıcılar başlat/durdur/yeniden başlat komutu gönderir, komut heartbeat ile ajana iletilir, sonucu komut geçmişinde ve işlem kayıtlarında görünür
- Web terminali: tarayıcıdan (xterm.js) kabuk erişimi; Linux sunuculara merkezden SSH ile (parola veya özel anahtar, şifreli saklanır, sunucu anahtarı ilk bağlantıda öğrenilir ve sonra doğrulanır), ajan kurulu sunuculara ajan üzerinden yerel kabuk (Windows'ta ConPTY ile PowerShell, Linux'ta PTY ile kabuk); yazılan komut satırları ve oturumlar (kim, hangi sunucu, ne zaman, nasıl kapandı) işlem kaydına yazılır; boşta kalma ve azami süre sınırları, kullanıcı başına eşzamanlı oturum sınırı, oturum sonlandırma
- API belirteçleri: `tmk_` önekli kişisel belirteçler, kapsam (izin) seçimi, geçerlilik süresi, yalnızca oluşturulurken gösterilir ve karması saklanır; `Authorization: Bearer` ile REST API erişimi; iptal; yöneticiler tüm kullanıcıların belirteçlerini görebilir
- Üretim kurulumu: Linux için tam otomatik kurulum/güncelleme/kaldırma/yedekleme/geri yükleme betikleri, sertleştirilmiş systemd birimleri ve Nginx HTTPS yapılandırması; Windows Server için Görev Zamanlayıcı tabanlı kurulum (ek hizmet yöneticisi gerekmez), yedekleme ve geri yükleme betikleri; üretimde güvenli çerez ve ortam doğrulaması

Tüm yedi geliştirme aşaması tamamlanmıştır. Hangi ortamların gerçekten test edildiği [docs/uyumluluk.md](docs/uyumluluk.md) dosyasında listelenir: merkezi sunucu ve ajan şu ana kadar yalnızca Windows 11 Pro üzerinde doğrulanmıştır; Windows Server ve Linux kurulumları betiklerle hedeflenmiş ancak gerçek makinede sınanmamıştır.

## Desteklenecek işletim sistemleri

İzlenen sunucular (ajan): Windows Server 2019 / 2022 / 2025, Ubuntu Server 22.04 / 24.04, Debian 12.
Merkezi sunucu: Ubuntu 22.04 / 24.04, Debian 12, Windows Server 2022 / 2025.

Uyumluluk, ilgili ortamda test edilmeden "doğrulanmış" olarak işaretlenmez.

## Mimari

```
Tarayıcı ──► Web arayüzü (Next.js) ──► Merkezi API (NestJS) ──► PostgreSQL
                                             │                 └─► Redis (kuyruk / önbellek)
İzlenen sunucular ◄── TronMonitor Agent (Go) ─┘  (dışa doğru, şifreli bağlantı)
```

Ayrıntılar için [docs/mimari.md](docs/mimari.md) dosyasına bakın. Docker kullanılmaz; tüm bileşenler işletim sistemi üzerinde doğrudan çalışır.

## Teknoloji yığını

| Katman | Teknoloji |
| --- | --- |
| Web arayüzü | Next.js, TypeScript, Tailwind CSS, shadcn/ui, Lucide, TanStack Query, Recharts |
| Arka uç | Node.js, NestJS, TypeScript, REST (`/api/v1`), WebSocket |
| Veritabanı | PostgreSQL, Prisma ORM |
| Kuyruk / önbellek | Redis (Windows'ta Redis uyumlu Memurai), BullMQ |
| Ajan | Go (yerel Windows ve Linux ikili dosyaları) |

## Geliştirme ortamı

Gereksinimler: Node.js 20+, PostgreSQL 15+, Redis 6+ (Windows'ta Memurai Developer).

```bash
npm install
cp apps/api/.env.example apps/api/.env      # değerleri düzenleyin
npm run prisma:generate
npm run prisma:migrate --workspace apps/api  # veya geliştirmede: npx prisma migrate dev
npm run dev:api                              # http://127.0.0.1:4000/api/v1 · belgeler: /api/docs
npm run dev:web                              # http://localhost:3000
```

Ayrıntılı kurulum adımları ve test komutları için [docs/gelistirme.md](docs/gelistirme.md) dosyasına bakın.

## Üretim kurulumu

```bash
# Linux (Ubuntu 22.04 / 24.04, Debian 12)
sudo bash deploy/server/linux/install.sh --domain tron.kurum.com
```

```powershell
# Windows Server (yönetici PowerShell; Node.js, PostgreSQL ve Memurai önceden kurulu)
deploy\server\windows\install.ps1 -PublicUrl https://tron.kurum.com -PgAdminPassword '<postgres parolası>'
```

Adım adım kurulum için [docs/kurulum.md](docs/kurulum.md); güncelleme, yedekleme, geri yükleme ve sorun giderme için [docs/isletim.md](docs/isletim.md); güvenlik modeli ve inceleme sonuçları için [docs/guvenlik.md](docs/guvenlik.md).

## Testler

```bash
npm run test --workspace apps/api              # birim testleri
npm run test:e2e --workspace apps/api          # uçtan uca testler (TEST_DATABASE_URL gerekir)
npm run typecheck && npm run lint && npm run build
```

## Güvenlik notları

- Parolalar scrypt ile karmalanır; oturum belirteçleri yalnızca HMAC karması olarak saklanır.
- Oturum çerezi `HttpOnly` ve `SameSite=Lax` olarak verilir; değiştirici isteklerde `X-Requested-With` başlığı zorunludur (CSRF koruması).
- Tüm yetki denetimleri arka uçta yapılır; arayüz yalnızca görünürlüğü düzenler.
- Kendi kendine kayıt varsayılan olarak kapalıdır; ilk hesap kurulum ekranından oluşturulur.
- Ajan iletişimi HMAC imzalı ve yeniden oynatmaya karşı korumalıdır; sırlar AES-256-GCM ile şifrelenir ve hiçbir uç noktadan geri okunamaz.
- Üretim öncesi savunma amaçlı kod incelemesi yapılmış, bulgular düzeltilmiştir; ayrıntılar ve işletmeci sorumlulukları [docs/guvenlik.md](docs/guvenlik.md) belgesindedir.

## Lisans

TronMonitor, [MIT Lisansı](LICENSE) ile dağıtılır.
