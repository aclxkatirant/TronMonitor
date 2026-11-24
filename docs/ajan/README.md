# TronMonitor Agent

TronMonitor Agent, izlenen her sunucuda çalışan, Go ile yazılmış tek bir yerel ikili dosyadır. Node.js, Docker veya ek bir çalışma zamanı gerektirmez. Merkezi TronMonitor sunucusuna yalnızca **dışa doğru** HTTPS bağlantısı kurar; izlenen sunucuda hiçbir port açılmaz. NAT veya güvenlik duvarı arkasındaki sunucular, merkeze dışa doğru erişebildiği sürece izlenebilir.

## İkili dosyalar

| Dosya | Platform |
| --- | --- |
| `tronmonitor-agent-windows-amd64.exe` | Windows Server 2019 / 2022 / 2025 (x64) |
| `tronmonitor-agent-windows-arm64.exe` | Windows Server (ARM64) |
| `tronmonitor-agent-linux-amd64` | Ubuntu 22.04 / 24.04, Debian 12 (x64) |
| `tronmonitor-agent-linux-arm64` | Ubuntu 22.04 / 24.04, Debian 12 (ARM64) |

Her yayınla birlikte `SHA256SUMS` dosyası üretilir. İndirilen dosyanın özeti kurulumdan önce doğrulanmalıdır.

## Uyumluluk durumu

| Platform | Durum |
| --- | --- |
| Windows 11 Pro (x64) | Doğrulandı: kayıt, ön plan çalıştırma, Windows hizmeti kurulumu, otomatik başlatma, kurtarma ayarı, metrik toplama, kaldırma |
| Windows Server 2019 / 2022 / 2025 | **Henüz doğrulanmadı.** Ajan yalnızca Windows Server 2019'da bulunan API'leri kullanır (kayıt defteri, WMI, performans sayaçları); gerçek sunucuda test edilene kadar uyumluluk "doğrulanmamış" kabul edilir |
| Ubuntu 22.04 / 24.04, Debian 12 | **Henüz doğrulanmadı.** İkili dosyalar çapraz derlenir; systemd birimi gerçek sistemde test edilmedi |

## Hızlı kurulum (panodan)

**Sunucular → Sunucu ekle** sihirbazı platforma özel tek satırlık bir komut üretir. Komut, `deploy/agent/install-agent.sh` veya `install-agent.ps1` betiğini merkezi sunucudan indirir; betik ikili dosyayı ve `SHA256SUMS` dosyasını indirir, özeti doğrular (uyuşmazsa hiçbir şey çalıştırmaz), ajanı kurar, kaydeder ve hizmeti başlatır. Kaldırmak için `uninstall-agent.sh` / `uninstall-agent.ps1` kullanılır.

## Komutlar

```
tronmonitor-agent register --server https://tron.kurum.com --token tmr_...   Sunucuyu kaydeder
tronmonitor-agent install  --server https://tron.kurum.com --token tmr_...   Kaydeder, hizmeti kurar ve başlatır
tronmonitor-agent run                                                       Ön planda çalıştırır
tronmonitor-agent service install | uninstall | start | stop | restart | status
tronmonitor-agent status                                                    Yapılandırma özeti ve hizmet durumu
tronmonitor-agent uninstall [--keep-config]                                 Hizmeti kaldırır, yapılandırmayı siler
tronmonitor-agent version
```

Ortak seçenekler: `--config <yol>` (varsayılan konumu değiştirir), `--log-level debug|info|warn|error`.

Kayıt seçenekleri: `--ca-file <pem>` (yalnızca verilen CA'ya güvenilir), `--service-user <hesap>`, `--force` (mevcut kaydın üzerine yazar), `--allow-http` (**yalnızca test ortamı**; üretimde HTTPS zorunludur).

## Dosya konumları

| | Windows | Linux |
| --- | --- | --- |
| Yapılandırma | `C:\ProgramData\TronMonitor\Agent\agent.json` | `/etc/tronmonitor/agent.json` |
| Günlükler | `C:\ProgramData\TronMonitor\Agent\logs\agent.log` | `/var/log/tronmonitor/agent.log` |
| Hizmet | Windows hizmeti `tronmonitor-agent` | systemd birimi `tronmonitor-agent.service` |

Yapılandırma dosyası ajanın gizli anahtarını içerir ve 0600 izinle yazılır; yalnızca hizmet hesabı ve yöneticiler okuyabilmelidir. Günlük dosyası 10 MB'ı aşınca döndürülür (3 kopya saklanır).

## Kayıt ve kimlik doğrulama

1. Panoda kısa ömürlü, tek kullanımlık bir **kayıt belirteci** (`tmr_...`) oluşturulur. Belirteç varsayılan olarak 60 dakika geçerlidir ve istendiğinde iptal edilebilir.
2. `register` komutu belirteci merkeze gönderir; merkez sunucu kaydını oluşturur ve ajana özel bir **anahtar kimliği** (`tma_...`) ile **gizli anahtar** döndürür. Belirteç aynı anda kullanılmış olarak işaretlenir; ikinci kullanım reddedilir.
3. Bundan sonra her istek HMAC-SHA256 ile imzalanır. İmza; HTTP yöntemi, yol, zaman damgası, tek kullanımlık nonce ve gövdenin SHA-256 özetini kapsar. Merkez ±5 dakikadan eski zaman damgalarını ve daha önce görülen nonce değerlerini reddeder (yeniden oynatma koruması).
4. Merkezde gizli anahtar şifrelenmiş saklanır; kalıcı bir sır hiçbir zaman ikili dosyaya gömülmez.
5. Kimlik bilgisi panodan iptal edilirse ajan `AGENT_CREDENTIAL_REVOKED` yanıtını alır, veri göndermeyi durdurur ve 10 dakikada bir yeniden dener. Sunucunun yeniden kaydedilmesi gerekir.

## Çalışma döngüsü

- **Heartbeat**: her 30 saniyede bir (merkez tarafından değiştirilebilir). Sürüm, açık kalma süresi ve sistem bilgisi gönderilir; yanıtla toplama aralığı güncellenebilir.
- **Metrikler**: varsayılan olarak her 15 saniyede bir CPU, bellek, disk hacimleri (kapasite ve G/Ç hızı), ağ arayüzleri (alınan/gönderilen bayt/sn, bağlantı durumu) ve Linux'ta yük ortalaması toplanır.
- **Kesinti dayanıklılığı**: merkez ulaşılamazsa örnekler bellekte tamponlanır (en fazla 240 örnek, yaklaşık 1 saat); bağlantı dönünce toplu gönderilir. Yeniden denemeler 5 saniyeden 5 dakikaya kadar üstel geri çekilmeyle yapılır.
- Merkez, 90 saniye boyunca heartbeat almadığı sunucuyu **çevrimdışı** olarak işaretler ve bağlantı geçmişine kaydeder.

## Yetkiler

- Kayıt ve metrik toplama yönetici yetkisi gerektirmez.
- Hizmet kurulumu Windows'ta yönetici, Linux'ta root yetkisi gerektirir.
- Windows'ta hizmet varsayılan olarak `LocalSystem` hesabıyla kurulur. Daha kısıtlı bir hesap (`--service-user`) kullanılacaksa bu hesaba yapılandırma ve günlük dizininde okuma/yazma izni verilmeli ve "Performance Monitor Users" grubuna eklenmelidir; bu senaryo henüz doğrulanmamıştır.
- Linux'ta systemd birimi `ProtectSystem=strict`, `NoNewPrivileges` ve yalnızca `/etc/tronmonitor` ile `/var/log/tronmonitor` yazma izniyle çalışır.

## Derleme

```bash
cd agent
./build.sh 0.1.0        # Linux/macOS
.\build.ps1 -Version 0.1.0   # Windows
```

Çıktılar `agent/dist/` altına yazılır; `CGO_ENABLED=0` ile statik derlenir.
