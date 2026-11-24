# Windows Server 2019 Ajan Kurulumu

> Uyumluluk durumu: **doğrulanmadı**. Ajan, Windows Server 2019 (10.0.17763) üzerinde bulunmayan hiçbir API'yi kullanmaz; ancak gerçek bir 2019 sunucusunda test edilene kadar uyumluluk "doğrulanmış" olarak işaretlenmez. Test edildiğinde bu bölüm güncellenecektir.

## Gereksinimler

- Windows Server 2019 Standard veya Datacenter, x64
- Merkezi TronMonitor adresine dışa doğru HTTPS (443) erişimi
- Hizmet kurulumu için yerel yönetici yetkisi
- Windows PowerShell 5.1 (işletim sistemiyle gelir)

## Adımlar

1. Panoda **Sunucular → Sunucu ekle** ile Windows Server 2019 seçin ve bir kayıt belirteci oluşturun (bu ekran bir sonraki sürümde etkinleşecektir; o zamana kadar belirteç API üzerinden oluşturulur).
2. Ajan ikili dosyasını indirin ve özetini doğrulayın:

```powershell
New-Item -ItemType Directory -Force "C:\Program Files\TronMonitor\Agent" | Out-Null
# tronmonitor-agent-windows-amd64.exe ve SHA256SUMS dosyalarını bu dizine kopyalayın
(Get-FileHash "C:\Program Files\TronMonitor\Agent\tronmonitor-agent-windows-amd64.exe" -Algorithm SHA256).Hash.ToLower()
# Çıktı, SHA256SUMS dosyasındaki değerle aynı olmalıdır.
```

3. Yönetici PowerShell'de kaydedin ve hizmeti kurun:

```powershell
& "C:\Program Files\TronMonitor\Agent\tronmonitor-agent-windows-amd64.exe" install --server https://tron.kurum.com --token tmr_XXXXXXXX
```

4. Doğrulayın:

```powershell
Get-Service tronmonitor-agent
& "C:\Program Files\TronMonitor\Agent\tronmonitor-agent-windows-amd64.exe" status
Get-Content "C:\ProgramData\TronMonitor\Agent\logs\agent.log" -Tail 20
```

Sunucu birkaç saniye içinde panoda **çevrimiçi** görünür.

## Windows Server 2019'a özgü notlar

- 2019'da `DisplayVersion` kayıt defteri değeri bulunmaz; ajan sürüm bilgisini `ReleaseId` ve `CurrentBuild` değerlerinden türetir (ör. `10.0.17763.xxxx`).
- TLS 1.2 varsayılan olarak etkindir; ajan TLS 1.2 ve üzerini kullanır.
- Özel bir sertifika otoritesi kullanıyorsanız `--ca-file C:\yol\ca.pem` seçeneğiyle kaydedin.

## Kaldırma

```powershell
& "C:\Program Files\TronMonitor\Agent\tronmonitor-agent-windows-amd64.exe" uninstall
Remove-Item -Recurse -Force "C:\Program Files\TronMonitor\Agent"
```

Sunucu kaydı panodan ayrıca kaldırılmalıdır.
