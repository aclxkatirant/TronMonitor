# İşletim: Güncelleme, Yedekleme, Geri Yükleme, Sorun Giderme

Kurulum için [kurulum.md](kurulum.md) dosyasına bakın. Buradaki tüm komutlar yönetici (root / yönetici PowerShell) gerektirir.

## Güncelleme

Güncelleme betiği önce yedek alır, kaynağı yeniler, bağımlılıkları kurar, API ve web'i derler, hizmetleri durdurup veritabanı göçlerini uygular ve hizmetleri başlatır. Sağlık ucu yanıt vermezse hata verir; bu durumda `restore` ile güncelleme öncesi yedeğe dönebilirsiniz.

**Linux**

```bash
# Uygulama dizini git klonuysa (install.sh --source <git-adresi> ile kurulduysa):
sudo bash /opt/tronmonitor/app/deploy/server/linux/update.sh
# Yeni sürüm ayrı bir dizindeyse:
sudo bash /opt/tronmonitor/app/deploy/server/linux/update.sh --source /tmp/tronmonitor-yeni
```

**Windows**

```powershell
git -C C:\Kaynak\TronMonitor pull
C:\TronMonitor\app\deploy\server\windows\update.ps1 -Source C:\Kaynak\TronMonitor
```

Güncelleme sırasında pano birkaç dakika erişilemez; ajanlar veriyi tamponlar ve bağlantı dönünce gönderir (yaklaşık 1 saatlik metrik tamponu).

Ajan güncellemesi: yeni ikili dosyalar `agent/dist` altına geldikten sonra her sunucuda `tronmonitor-agent` yeniden kurulur; sürüm panoda **Sunucular → ayrıntı → Ajan** kartında görünür. (Otomatik ajan güncellemesi henüz yoktur.)

## Yedekleme

Yedek arşivi şunları içerir: PostgreSQL dökümü (`pg_dump` özel biçim, `database.dump`), `api.env` (sırlar dahil!) ve `agent-dist` (ajan ikili dosyaları). Arşiv yalnızca yöneticilerin okuyabileceği izinle yazılır; **başka bir ortama taşırken şifreleyin**.

**Linux**

```bash
sudo bash /opt/tronmonitor/app/deploy/server/linux/backup.sh            # /var/lib/tronmonitor/backups, son 14 yedek tutulur
sudo bash /opt/tronmonitor/app/deploy/server/linux/backup.sh --dir /mnt/yedek --keep 30
```

Günlük otomatik yedek için systemd zamanlayıcısı:

```bash
sudo cp /opt/tronmonitor/app/deploy/server/linux/tronmonitor-backup.{service,timer} /etc/systemd/system/
sudo systemctl enable --now tronmonitor-backup.timer
systemctl list-timers tronmonitor-backup.timer
```

**Windows**

```powershell
C:\TronMonitor\app\deploy\server\windows\backup.ps1 -Keep 14
```

Günlük görev için (yönetici PowerShell):

```powershell
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -ExecutionPolicy Bypass -File C:\TronMonitor\app\deploy\server\windows\backup.ps1 -Keep 14'
Register-ScheduledTask -TaskName 'TronMonitor Backup' -Action $action -Trigger (New-ScheduledTaskTrigger -Daily -At 03:15) -Principal (New-ScheduledTaskPrincipal -UserId 'SYSTEM' -RunLevel Highest)
```

Yedekleri düzenli olarak başka bir makineye kopyalayın; geri yüklemeyi en az bir kez prova edin.

## Geri yükleme

Geri yükleme mevcut veritabanı içeriğini **siler** ve yedektekiyle değiştirir; ardından eksik göçleri uygular (eski sürümden alınmış yedekler yeni sürüme yükseltilir). `--with-env` / `-WithEnv` verilirse `api.env` de geri yüklenir (yeni makineye taşıma senaryosu; `ENCRYPTION_KEY` aynı olmazsa şifreli sırlar çözülemez).

```bash
sudo bash /opt/tronmonitor/app/deploy/server/linux/restore.sh /var/lib/tronmonitor/backups/tronmonitor-20260101-031500.tar.gz
```

```powershell
C:\TronMonitor\app\deploy\server\windows\restore.ps1 -Archive C:\TronMonitor\backups\tronmonitor-20260101-031500.zip
```

Yeni bir makineye taşıma: önce kurulum betiğini çalıştırın (boş veritabanı), sonra `restore --with-env` ile yedeği yükleyin, en son `WEB_ORIGIN` ve adres ayarlarını denetleyin.

## Kaldırma

```bash
sudo bash /opt/tronmonitor/app/deploy/server/linux/uninstall.sh          # veritabanı, api.env ve yedekler korunur
sudo bash /opt/tronmonitor/app/deploy/server/linux/uninstall.sh --purge  # her şey silinir
```

```powershell
C:\TronMonitor\app\deploy\server\windows\uninstall.ps1
C:\TronMonitor\app\deploy\server\windows\uninstall.ps1 -Purge -PgAdminPassword '<postgres parolası>'
```

## Günlükler ve izleme

| | Linux | Windows |
| --- | --- | --- |
| API | `journalctl -u tronmonitor-api -f` | `C:\TronMonitor\logs\api-YYYYMMDD.log` (+ `.err.log`) |
| Web | `journalctl -u tronmonitor-web -f` | `C:\TronMonitor\logs\web-YYYYMMDD.log` |
| Nginx | `/var/log/nginx/tronmonitor.*.log` | Nginx `logs\` dizini |
| Sağlık | `curl http://127.0.0.1:4000/api/v1/health` | `Invoke-WebRequest http://127.0.0.1:4000/api/v1/health` |

API günlükleri JSON satırlarıdır (pino); `LOG_LEVEL=debug` ile ayrıntı artar. Sağlık ucu veritabanı ve Redis'i denetler; `degraded` dönerse 503 verir, dış izleme sistemine bağlanabilir.

Arka plan işleri (çevrimdışı tespiti, metrik özetleme, saklama temizliği, erişilebilirlik kontrolleri, bildirim teslimi) BullMQ ile Redis'te çalışır. Redis yeniden başlatılırsa zamanlayıcılar API yeniden başlatıldığında yeniden kaydedilir.

## Sorun giderme

| Belirti | Olası neden / çözüm |
| --- | --- |
| API başlamıyor, günlükte `Ortam değişkenleri geçersiz` | `api.env` eksik/bozuk; mesaj hangi değişkenin hatalı olduğunu söyler. `ENCRYPTION_KEY` base64 kodlu 32 bayt olmalıdır |
| `Üretimde WEB_ORIGIN http:// ise COOKIE_SECURE=false ...` | HTTPS kullanmıyorsanız `COOKIE_SECURE=false` yazın (yalnızca iç ağ) |
| Giriş sonrası hemen çıkış, "oturum geçersiz" | `WEB_ORIGIN` panonun gerçek adresiyle eşleşmiyor ya da ters vekil `X-Forwarded-Proto` göndermiyor; HTTPS'siz adreste `COOKIE_SECURE=true` ise çerez gönderilmez |
| Pano "Yoklama" modunda kalıyor, terminal açılmıyor | Ters vekil WebSocket'i geçirmiyor: `Upgrade`/`Connection` başlıkları ve uzun `proxy_read_timeout` gerekli (bkz. `deploy/server/nginx/tronmonitor.conf`) |
| Ajan "sunucuya ulaşılamadı" | Ajan makinesinden `curl https://tron.kurum.com/api/v1/health`; sertifika özel CA ise ajana `--ca-file` verin |
| Ajan `AGENT_TIMESTAMP_SKEW` | Ajan makinesinin saati 5 dakikadan fazla sapmış; NTP'yi düzeltin |
| Sunucu ekle sihirbazında indirme 404 | `agent/dist` boş ya da `SHA256SUMS` yok; ajanı derleyip kopyalayın |
| ICMP kontrolleri hep başarısız (Linux) | API `ping` komutunu çalıştıramıyor; systemd biriminde `AmbientCapabilities=CAP_NET_RAW` olmalı (kurulum betiği ekler) |
| Metrik grafikleri boş | Zaman aralığı için özet yok; 5 dakikalık özetler her 5 dakikada, saatlik/günlük özetler bakım işiyle üretilir. Redis'in çalıştığını denetleyin |
| Windows görevi çalışıyor ama API yok | `C:\TronMonitor\logs\api-*.err.log`; LocalService'in `app` dizinini okuyabildiğini (`icacls`) ve Node'un sistem PATH'inde olduğunu denetleyin |

## Kapasite ve saklama

Varsayılan saklama: ham metrikler 7 gün, 5 dakikalık özetler 30 gün, saatlik özetler 1 yıl, günlük özetler 2 yıl; erişilebilirlik sonuçları ve işlem kayıtları için de **Ayarlar** sayfasından süre belirlenir. 50 sunucu ve 15 sn toplama aralığında ham metrik tablosu haftada yaklaşık 1–2 GB büyür; disk alarmı için sunucunun kendisine de ajan kurup eşik tanımlayın.
