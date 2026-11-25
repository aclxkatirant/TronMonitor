# Üretim Kurulumu

Bu belge TronMonitor merkezi sunucusunun üretim ortamına kurulumunu anlatır. Ajan kurulumu için [ajan/README.md](ajan/README.md), geliştirme ortamı için [gelistirme.md](gelistirme.md) dosyasına bakın.

Merkezi sunucu üç parçadan oluşur: **API** (NestJS, varsayılan 127.0.0.1:4000), **web arayüzü** (Next.js, varsayılan 127.0.0.1:3000) ve ters vekil (**Nginx** ya da IIS) üzerinden sunulan tek bir HTTPS adresi. PostgreSQL ve Redis aynı makinede ya da ayrı bir makinede olabilir. Docker kullanılmaz.

## Gereksinimler

| Bileşen | Sürüm | Not |
| --- | --- | --- |
| İşletim sistemi | Ubuntu 22.04 / 24.04, Debian 12 **veya** Windows Server 2019 / 2022 / 2025 | Linux kurulumu betikle tam otomatik; Windows'ta ön koşullar elle kurulur |
| Node.js | 22 LTS veya üzeri | Linux betiği NodeSource deposundan kurar |
| PostgreSQL | 14 veya üzeri (17 ile geliştirildi) | Linux betiği dağıtım paketini kurar |
| Redis | 6 veya üzeri; Windows'ta Memurai | Yalnızca 127.0.0.1'de dinlemelidir |
| Nginx | 1.18+ | HTTPS, WebSocket vekili; Windows'ta Nginx for Windows veya IIS + ARR |
| Go | 1.22+ (isteğe bağlı) | Ajan ikili dosyalarını sunucuda derlemek için; yoksa başka makinede derlenip kopyalanır |
| Kaynaklar | 2 vCPU, 4 GB RAM, 20 GB disk | 50 sunucuya kadar; metrik saklama süresi arttıkça disk büyür |

Açık portlar: dışarıya yalnızca 443 (ve 80 → 443 yönlendirmesi). Ajanlar merkeze **dışa doğru** HTTPS ile bağlanır; izlenen sunucularda port açılmaz.

## Linux (Ubuntu / Debian)

### 1. Kaynağı alın

```bash
sudo apt-get install -y git
git clone https://github.com/aclxkatirant/TronMonitor.git /tmp/tronmonitor-src
```

### 2. Kurulum betiğini çalıştırın

```bash
sudo bash /tmp/tronmonitor-src/deploy/server/linux/install.sh --domain tron.kurum.com
```

Betik sırasıyla: sistem paketlerini (Node.js 22, PostgreSQL, Redis, Nginx) kurar; `tronmonitor` sistem kullanıcısını ve dizinleri oluşturur; kaynağı `/opt/tronmonitor/app` altına kopyalar; `tronmonitor` veritabanı ve rolünü rastgele parolayla oluşturur; `/etc/tronmonitor/api.env` dosyasına rastgele `SESSION_SECRET` ve `ENCRYPTION_KEY` yazar; `npm ci` ve derlemeleri `tronmonitor` kullanıcısıyla çalıştırır; veritabanı göçlerini uygular; Go varsa ajanı derler; `tronmonitor-api` ve `tronmonitor-web` systemd birimlerini kurup başlatır; Nginx sitesini HTTPS ile yapılandırır (sertifika verilmediyse kendinden imzalı üretir); sağlık ucunu bekler.

Sık kullanılan seçenekler:

| Seçenek | Açıklama |
| --- | --- |
| `--tls-cert <yol> --tls-key <yol>` | Mevcut sertifikayı kullan |
| `--source <dizin \| git-adresi>` | Kaynak; varsayılan betiğin bulunduğu depo |
| `--database-url <url>` / `--redis-url <url>` | Harici PostgreSQL / Redis; yerel paket kurulmaz |
| `--no-nginx` | Kendi ters vekilinizi kullanın (yapılandırma örneği: `deploy/server/nginx/tronmonitor.conf`) |
| `--http` | HTTPS olmadan düz HTTP (yalnızca kapalı iç ağ; çerezler güvenli bayraksız gönderilir) |
| `--skip-system-deps` | apt ile paket kurma |
| `--force` | Doğrulanmamış dağıtımda devam et |

Betik yeniden çalıştırılabilir: mevcut `api.env` ve veritabanı korunur, yalnızca kod yenilenir.

### 3. Sertifika

Kendinden imzalı sertifikayla başladıysanız Let's Encrypt'e geçin:

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d tron.kurum.com
```

certbot, `/etc/nginx/sites-available/tronmonitor` dosyasındaki sertifika yollarını kendisi günceller.

### 4. İlk hesap

Tarayıcıda `https://tron.kurum.com/kurulum` adresini açın; oluşturulan ilk hesap **Süper Yönetici** olur. Sonrasında kendi kendine kayıt kapalıdır; kullanıcılar **Kullanıcılar** sayfasından açılır.

### Dizinler

| Yol | İçerik |
| --- | --- |
| `/opt/tronmonitor/app` | Uygulama kodu ve derlemeleri (`tronmonitor` kullanıcısına ait) |
| `/etc/tronmonitor/api.env` | API ortam değişkenleri ve sırlar (`root:tronmonitor`, 0640) |
| `/etc/tronmonitor/tls/` | Kendinden imzalı sertifika (üretildiyse) |
| `/var/lib/tronmonitor/backups` | Yedekler |
| `/etc/systemd/system/tronmonitor-*.service` | Hizmet birimleri |
| `/etc/nginx/sites-available/tronmonitor` | Nginx sitesi |

Günlükler journald'dadır: `journalctl -u tronmonitor-api -f`, `journalctl -u tronmonitor-web -f`.

## Windows Server

Windows'ta API ve web, **Görev Zamanlayıcı** görevleri olarak `NT AUTHORITY\LocalService` hesabıyla çalışır (sistem açılışında başlar, çökünce sarmalayıcı 5 sn sonra yeniden başlatır). Ek bir hizmet yöneticisi (NSSM/WinSW) indirilmez.

### 1. Ön koşullar (elle)

1. **Node.js 22 LTS**: https://nodejs.org (MSI; "Add to PATH" seçili).
2. **PostgreSQL 14+**: EDB kurulum paketi; `C:\Program Files\PostgreSQL\<sürüm>\bin` dizinini sistem PATH'ine ekleyin (`psql`, `pg_dump`, `pg_restore` gerekir). `postgres` kullanıcısının parolasını not edin.
3. **Memurai** (Redis uyumlu): https://www.memurai.com; hizmet olarak 127.0.0.1:6379'da çalışmalıdır.
4. **Git** (kaynağı almak için) ve isteğe bağlı **Go** (ajanı sunucuda derlemek için).

Kurulumdan sonra yeni bir **yönetici** PowerShell penceresi açın (PATH güncellemesi için).

### 2. Kurulum

```powershell
git clone https://github.com/aclxkatirant/TronMonitor.git C:\Kaynak\TronMonitor
Set-ExecutionPolicy -Scope Process Bypass
C:\Kaynak\TronMonitor\deploy\server\windows\install.ps1 -PublicUrl https://tron.kurum.com -PgAdminPassword '<postgres parolası>'
```

Betik: ön koşulları doğrular; `C:\TronMonitor\app` altına kaynağı kopyalar; `tronmonitor` veritabanı ve rolünü oluşturur; `C:\TronMonitor\config\api.env` dosyasına sırları yazar; `npm ci`, derleme ve göçleri çalıştırır; dizin izinlerini LocalService için ayarlar; `TronMonitor API` ve `TronMonitor Web` görevlerini kaydedip başlatır; sağlık ucunu bekler.

Parametreler: `-InstallDir` (varsayılan `C:\TronMonitor`), `-ApiPort`/`-WebPort`, `-DatabaseUrl` (hazır veritabanı; rol oluşturulmaz), `-RedisUrl`, `-ServiceAccount`, `-OpenFirewall` (gerekli portlara gelen kural ekler), `-SkipAgentBuild`, `-TaskPrefix` (yan yana kurulumlar için).

### 3. Çalışma modları

- **Ters vekil modu** (`-PublicUrl https://...`, önerilen): web ve API yalnızca 127.0.0.1'de dinler. HTTPS'i ve `/api/` yönlendirmesini (WebSocket dahil) ters vekil üstlenir:
  - **Nginx for Windows**: `deploy/server/nginx/tronmonitor.conf` dosyasındaki `__DOMAIN__`, `__TLS_CERT__`, `__TLS_KEY__` yer tutucularını doldurup `conf/nginx.conf` içinden `include` edin.
  - **IIS + ARR**: URL Rewrite ve Application Request Routing kurun, `/api/*` için `http://127.0.0.1:4000`, geri kalan için `http://127.0.0.1:3000` ters vekil kuralı ekleyin ve ARR'de WebSocket desteğini açın (IIS 8+). Bu yol belgelendi ancak **doğrulanmadı**.
- **Basit mod** (`-PublicUrl` verilmezse): pano `http://<sunucu-adı>:3000` üzerinden sunulur; WebSocket'ler doğrudan `:4000` portuna gider (API `0.0.0.0`'da dinler, `COOKIE_SECURE=false`). HTTPS yoktur; yalnızca kapalı iç ağ için. `-OpenFirewall` ile 3000 ve 4000 açılır.

### 4. İlk hesap

`https://tron.kurum.com/kurulum` (ya da basit modda `http://<sunucu-adı>:3000/kurulum`) adresinden ilk Süper Yönetici'yi oluşturun.

### Dizinler

| Yol | İçerik |
| --- | --- |
| `C:\TronMonitor\app` | Uygulama kodu ve derlemeleri |
| `C:\TronMonitor\config\api.env` | Ortam değişkenleri ve sırlar (yalnızca yöneticiler, SYSTEM ve hizmet hesabı okur) |
| `C:\TronMonitor\bin` | Görevlerin çalıştırdığı sarmalayıcı betikler |
| `C:\TronMonitor\logs` | `api-YYYYMMDD.log`, `web-YYYYMMDD.log` ve `.err.log` dosyaları |
| `C:\TronMonitor\backups` | Yedekler |

## Ortam değişkenleri (api.env)

| Değişken | Açıklama |
| --- | --- |
| `NODE_ENV` | `production` |
| `API_HOST` / `API_PORT` | Dinleme adresi; ters vekil arkasında `127.0.0.1` |
| `WEB_ORIGIN` | Panonun dış adresi (CORS, WebSocket Origin denetimi, çerezler) |
| `DATABASE_URL` | `postgresql://kullanıcı:parola@sunucu:5432/veritabanı` |
| `REDIS_URL` | `redis://127.0.0.1:6379` |
| `SESSION_SECRET` | Oturum belirteçleri için HMAC anahtarı (en az 32 karakter) |
| `ENCRYPTION_KEY` | Ajan sırları, SSH kimlik bilgileri ve bildirim yapılandırmaları için AES-256-GCM anahtarı (base64, 32 bayt). **Değiştirilirse mevcut sırlar çözülemez**; yedeklerinizle birlikte saklayın |
| `SESSION_TTL_HOURS` | Oturum süresi (saat) |
| `COOKIE_SECURE` | Boşsa üretimde `true`. `WEB_ORIGIN` `http://` ise açıkça `false` verilmelidir |
| `LOG_LEVEL` | `info` (varsayılan), `debug`, `warn` |
| `AGENT_RELEASES_DIR` / `AGENT_SCRIPTS_DIR` | Ajan ikili dosyaları (`SHA256SUMS` ile) ve kurulum betikleri |
| `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` | İsteğe bağlı: veritabanı boşken ilk yöneticiyi otomatik oluşturur |

Değişiklikten sonra API'yi yeniden başlatın (`systemctl restart tronmonitor-api` / görevi yeniden başlatın).

## Ajan ikili dosyaları

Pano, ajan ikili dosyalarını `AGENT_RELEASES_DIR` içinden `SHA256SUMS` ile birlikte sunar. Sunucuda Go yoksa ajanı başka bir makinede derleyin (`agent/build.sh <sürüm>` veya `agent\build.ps1 -Version <sürüm>`) ve `dist/` içeriğini `<uygulama>/agent/dist/` dizinine kopyalayın. Özet dosyası olmayan ikili dosyalar sunulmaz.

## Kurulum sonrası denetim listesi

- `curl -s https://tron.kurum.com/api/v1/health` → `{"status":"ok",...}`
- Sunucu ekle sihirbazından bir ajan kurup sunucunun **Çevrimiçi** olduğunu görün.
- Bildirim kanalı tanımlayıp "Test gönder" ile doğrulayın.
- İlk yedeği alın ve geri yükleme adımlarını [isletim.md](isletim.md) belgesinden okuyun.
- `api.env` ve `ENCRYPTION_KEY` için güvenli bir kopya tutun.
