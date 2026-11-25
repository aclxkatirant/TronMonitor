# Uyumluluk Durumu

Bu tablo yalnızca **gerçekten test edilmiş** ortamları "Doğrulandı" olarak işaretler. Diğer satırlar hedeflenen ancak henüz sınanmamış ortamlardır; sorun bildirimleri için depoyu kullanın.

## Merkezi sunucu

| Ortam | Durum | Not |
| --- | --- | --- |
| Windows 11 Pro (x64), Node 24, PostgreSQL 17, Memurai | Doğrulandı | Geliştirme ve e2e testleri; `deploy/server/windows/install.ps1` ile basit modda tam kurulum, Görev Zamanlayıcı görevleri, sağlık ucu ve giriş sayfası doğrulandı |
| Windows Server 2019 / 2022 / 2025 | Doğrulanmadı | Betikler Windows 11 ile aynı yolu izler; Server'da PATH, UAC ve Görev Zamanlayıcı davranışı aynı beklenir |
| Ubuntu 22.04 / 24.04 | Doğrulanmadı | `deploy/server/linux/*.sh` sözdizimi denetlendi (`bash -n`); gerçek kurulum denenmedi |
| Debian 12 | Doğrulanmadı | Ubuntu ile aynı betikler; ICMP için `CAP_NET_RAW` systemd biriminde verilir |
| IIS + ARR ters vekil | Doğrulanmadı | Nginx yapılandırması referans alınarak elle kurulur |
| Nginx (Linux) | Doğrulanmadı | Yapılandırma dosyası `nginx -t` ile kurulum sırasında sınanır |

## Ajan

| Ortam | Durum | Not |
| --- | --- | --- |
| Windows 11 Pro (x64) | Doğrulandı | Kayıt, Windows hizmeti, metrikler, hizmet listesi ve komutları, ConPTY ile PowerShell web terminali |
| Windows Server 2019 / 2022 / 2025 (x64) | Doğrulanmadı | ConPTY için Server 2019 (1809) ve üzeri gerekir; aksi halde terminal isteği açıklamayla reddedilir |
| Windows (ARM64) | Doğrulanmadı | Derleme hedefi var |
| Ubuntu 22.04 / 24.04 (amd64, arm64) | Doğrulanmadı | Çapraz derleme yapılıyor; systemd birimi ve PTY kabuğu gerçek makinede denenmedi |
| Debian 12 | Doğrulanmadı | Ubuntu ile aynı ikili dosya |

## Web terminali

| Yol | Durum | Not |
| --- | --- | --- |
| Ajan kabuğu (Windows, ConPTY) | Doğrulandı | Tarayıcıdan PowerShell oturumu, komut kaydı, sonlandırma |
| Ajan kabuğu (Linux, PTY) | Doğrulanmadı | `creack/pty` ile `$SHELL -l` |
| SSH (parola) | Kısmen doğrulandı | Testlerdeki yerel `ssh2` sunucusuna ve yerel test SSH sunucusuna karşı; gerçek bir Linux OpenSSH sunucusuna karşı denenmedi |
| SSH (özel anahtar) | Doğrulanmadı | Anahtar ayrıştırma ve kayıt doğrulandı, bağlantı denenmedi |
| WinRM | Uygulanmadı | Şemada ayrılmış; Windows için ajan kabuğu kullanılır |

## Tarayıcılar

Pano Chromium tabanlı tarayıcıda (Claude masaüstü tarayıcı paneli) doğrulandı; Firefox ve Safari denenmedi. Terminal, xterm.js 5 gerektirir (modern tarayıcılar).

## Nasıl doğrulanır

Bir ortamı doğrulamak için: kurulum betiğini çalıştırın, `health` ucunu ve `/kurulum` akışını deneyin, bir ajan kaydedip sunucunun çevrimiçi olduğunu, hizmet listesinin geldiğini ve terminalin açıldığını görün; sonucu bu tabloya işleyin (tarih ve sürüm ile).

### Yalnızca ajanı canlı bir sunucuda doğrulama

Merkezi sunucu kurulmadan, geliştirme makinesindeki merkez kullanılarak yalnızca ajan sınanabilir. Ajan sunucuya iki dizin (`C:\Program Files\TronMonitor\Agent`, `C:\ProgramData\TronMonitor\Agent` / Linux'ta `/opt/tronmonitor`, `/etc/tronmonitor`, `/var/log/tronmonitor`) ve tek bir hizmet yazar; güvenlik duvarı, kayıt defteri veya başka bir ayara dokunmaz, port açmaz, yeniden başlatma gerektirmez. Kaldırma betiği hepsini geri alır.

1. Geliştirme makinesinde API'yi yerel ağa açın: `.claude/launch.json` içindeki `api-lan` yapılandırması `API_HOST=0.0.0.0` ile başlatır. Güvenlik duvarında 4000 portunu yalnızca sınanacak sunucunun IP'sine açın.
2. Panoda **Sunucular → Sunucu ekle** ile kayıt belirteci üretin; komuttaki adresi `http://<geliştirme-makinesi-ip>:4000` olarak kullanın. HTTP olduğundan `-AllowHttp` / `--allow-http` gerekir ve ajanın gizli anahtarı kayıt sırasında yerel ağda şifresiz gider; test bitince kayıt silinmelidir.
3. Sunucuda betiği önce dosyaya indirin, inceleyin, sonra yönetici oturumunda çalıştırın. Panoda çevrimiçi durumu, metrikleri ve hizmet listesini görün. Terminali yalnızca salt okunur komutlarla (`whoami`, `hostname`) sınayın; terminal hizmet hesabıyla (Windows'ta SYSTEM) çalışır. Canlı sunucuda hizmet başlat/durdur komutunu denemeyin ya da zararsız bir hizmet seçin.
4. Kaldırma betiğini çalıştırın, panodan sunucu kaydını silin, güvenlik duvarı kuralını kaldırın ve bu tabloyu tarih ve sürümle güncelleyin.
