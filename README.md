# TronMonitor

**Tüm altyapınız, tek merkezde.**

TronMonitor; Windows Server ve Linux sunucularınızı tek bir web panosundan izlemenizi, yönetmenizi ve denetlemenizi sağlayan, çapraz platform bir altyapı yönetim platformudur.

> Durum: Erken geliştirme aşaması. Aşağıdaki "Uygulanan özellikler" bölümü yalnızca bu depoda gerçekten çalışan ve test edilen yetenekleri listeler.

## Uygulanan özellikler

- Kimlik doğrulama: ilk kurulumda süper yönetici oluşturma, e-posta/parola ile giriş, güvenli oturum çerezleri, parola değiştirme, etkin oturumları görüntüleme ve sonlandırma
- Rol tabanlı yetkilendirme: Süper Yönetici, Yönetici, Operatör, İzleyici rolleri; ayrıntılı izin kataloğu; kullanıcı bazında ek izin atama
- Kullanıcı yönetimi: kullanıcı listeleme, arama, filtreleme, oluşturma, düzenleme, devre dışı bırakma, parola sıfırlama
- İşlem kayıtları (altyapı): giriş, çıkış, kayıt, parola ve kullanıcı değişiklikleri veritabanına kaydedilir
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

Erişilebilirlik kontrolleri, olay yönetimi, hizmet izleme, web terminali, bildirimler ve API belirteçleri **henüz uygulanmamıştır**; arayüzde bu modüller "henüz etkin değil" durumuyla gösterilir. Ajan şu ana kadar yalnızca Windows 11 Pro üzerinde doğrulanmıştır; Windows Server ve Linux uyumluluk durumu için [docs/ajan/README.md](docs/ajan/README.md) dosyasına bakın.

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

## Lisans

TronMonitor, [MIT Lisansı](LICENSE) ile dağıtılır.
