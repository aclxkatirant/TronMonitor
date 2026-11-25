# Değişiklik Günlüğü

Biçim [Keep a Changelog](https://keepachangelog.com/tr/1.1.0/) ilkelerine, sürümleme [Semantic Versioning](https://semver.org/lang/tr/) kurallarına uyar.

## [Unreleased]

### Düzeltildi

- Windows'ta derlenen `SHA256SUMS` dosyası CRLF satır sonlu yazılıyordu; Linux kurulum betiği özeti bulamıyordu. Derleme betiği artık LF yazar, Linux kurulum betiği CRLF'ye de tolerans gösterir.

## [1.0.0] - 2026-11-25

İlk kararlı sürüm. Yedi geliştirme aşamasının tamamını kapsar.

### Eklendi

- **Merkezi sunucu:** NestJS API (PostgreSQL/Prisma, Redis/BullMQ) ve Next.js panosu; tamamen Türkçe arayüz.
- **Kimlik ve yetki:** Veritabanı destekli oturumlar, CSRF koruması, rol ve izin kataloğu, API belirteçleri (`tmk_`), tüm yetki denetimleri arka uçta.
- **Ajan:** Go ile yazılmış tek ikili dosya (Windows x64/ARM64, Linux x64/ARM64); HMAC-SHA256 imzalı istekler, yeniden oynatma koruması, tek kullanımlık kayıt belirteci, Windows hizmeti ve systemd birimi, kesintide tamponlama.
- **İzleme:** CPU, bellek, disk, ağ metrikleri; 5 dakikalık, saatlik ve günlük toplamlar; saklama süreleri; gerçek zamanlı WebSocket kanalı.
- **Uptime ve olaylar:** HTTP, TCP ve ICMP denetimleri, olay (incident) yaşam döngüsü, bildirim kanalları (e-posta, webhook).
- **Hizmet yönetimi:** Windows hizmetleri ve systemd birimlerinin listelenmesi, izlenmesi ve başlat/durdur/yeniden başlat komutları (anlık komut kanalı).
- **Web terminali:** Tarayıcıdan SSH ve ajan kabuğu (ConPTY / PTY); sunucu başına kimlik bilgisi, ana makine anahtarı doğrulaması, komut geçmişi.
- **Denetim kaydı:** Önemli işlemler kullanıcı, IP ve zaman damgasıyla kaydedilir; panoda filtrelenebilir.
- **Dağıtım:** Linux (systemd + Nginx) ve Windows (Görev Zamanlayıcı) için kurulum, güncelleme, yedekleme, geri yükleme ve kaldırma betikleri; Docker kullanılmaz.
- **Belgeler:** Kurulum, işletim, güvenlik, uyumluluk ve ajan belgeleri (`docs/`).

### Güvenlik

- Oturum iptali açık WebSocket ve terminal bağlantılarını anında kapatır.
- Kullanıcı yalnızca kendi sahip olduğu izinleri başkasına verebilir.
- API belirteçleriyle hesap yönetimi uçlarına erişilemez.
- Hassas uçlarda hız sınırı; `X-Forwarded-For` yalnızca ters vekil arkasında dikkate alınır.
- Üretimde çerez `Secure` varsayılanı; düz HTTP için açık onay gerekir.

### Bilinen sınırlar

- Windows Server 2019/2022/2025 ve Ubuntu/Debian üzerinde gerçek makine doğrulaması yapılmadı; ayrıntı için `docs/uyumluluk.md`.
- IIS + ARR ters vekil yolu yalnızca belgelendi; WinRM desteği yok.

[1.0.0]: https://github.com/aclxkatirant/TronMonitor/releases/tag/v1.0.0
