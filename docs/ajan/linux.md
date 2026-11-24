# Linux Ajan Kurulumu (Ubuntu 22.04 / 24.04, Debian 12)

> Uyumluluk durumu: **doğrulanmadı**. İkili dosyalar Linux amd64 ve arm64 için çapraz derlenir ve `CGO_ENABLED=0` ile statiktir (glibc bağımlılığı yoktur); ancak gerçek bir Ubuntu/Debian sisteminde systemd entegrasyonu test edilene kadar "doğrulanmış" olarak işaretlenmez.

## Gereksinimler

- Ubuntu Server 22.04 LTS, 24.04 LTS veya Debian 12; amd64 ya da arm64
- systemd (tüm desteklenen dağıtımlarda varsayılan)
- Merkezi TronMonitor adresine dışa doğru HTTPS erişimi
- Hizmet kurulumu için root (sudo) yetkisi

## Adımlar

```bash
# 1) İkili dosyayı indirin ve özetini doğrulayın
sudo mkdir -p /opt/tronmonitor
# tronmonitor-agent-linux-amd64 ve SHA256SUMS dosyalarını /opt/tronmonitor altına kopyalayın
cd /opt/tronmonitor && sha256sum -c --ignore-missing SHA256SUMS
sudo chmod 755 /opt/tronmonitor/tronmonitor-agent-linux-amd64
sudo ln -sf /opt/tronmonitor/tronmonitor-agent-linux-amd64 /usr/local/bin/tronmonitor-agent

# 2) Kaydedin, systemd birimini kurun ve başlatın
sudo tronmonitor-agent install --server https://tron.kurum.com --token tmr_XXXXXXXX

# 3) Doğrulayın
systemctl status tronmonitor-agent
sudo tronmonitor-agent status
sudo tail -n 20 /var/log/tronmonitor/agent.log
```

Sunucu birkaç saniye içinde panoda **çevrimiçi** görünür. Birim `multi-user.target` ile etkinleştirilir; sunucu yeniden başladığında ajan otomatik başlar ve çökme durumunda 5 saniye sonra yeniden başlatılır.

## Kısıtlı hesapla çalıştırma

Varsayılan olarak hizmet root ile kurulur. `--service-user tronmonitor` ile ayrı bir sistem hesabı kullanılabilir:

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin tronmonitor
sudo mkdir -p /etc/tronmonitor /var/log/tronmonitor
sudo chown tronmonitor:tronmonitor /etc/tronmonitor /var/log/tronmonitor
sudo tronmonitor-agent install --server https://tron.kurum.com --token tmr_XXXXXXXX --service-user tronmonitor
```

CPU, bellek, disk ve ağ metrikleri `/proc` ve `/sys` üzerinden yetkisiz hesapla okunabilir. Bu senaryo henüz doğrulanmamıştır.

## Kaldırma

```bash
sudo tronmonitor-agent uninstall
sudo rm -rf /opt/tronmonitor /usr/local/bin/tronmonitor-agent /var/log/tronmonitor
```

Sunucu kaydı panodan ayrıca kaldırılmalıdır.
