# Windows Server 2022 Ajan Kurulumu

> Uyumluluk durumu: **doğrulanmadı**. Aynı ikili dosya Windows 11 Pro (10.0.26300) üzerinde hizmet olarak doğrulanmıştır; Windows Server 2022 (10.0.20348) üzerinde test edilene kadar "doğrulanmış" olarak işaretlenmez.

Kurulum adımları [Windows Server 2019 kılavuzu](windows-server-2019.md) ile aynıdır:

```powershell
& "C:\Program Files\TronMonitor\Agent\tronmonitor-agent-windows-amd64.exe" install --server https://tron.kurum.com --token tmr_XXXXXXXX
Get-Service tronmonitor-agent
```

## Windows Server 2022'ye özgü notlar

- `DisplayVersion` değeri (ör. `21H2`) mevcuttur ve panoda işletim sistemi adının yanında gösterilir.
- Server Core kurulumlarında da PowerShell üzerinden aynı komutlar kullanılır; grafik arayüz gerekmez.
- TLS 1.3 desteklenir; ajan sunucuyla en yüksek ortak sürümü kullanır.

Kaldırma ve sorun giderme için [genel ajan kılavuzuna](README.md) bakın.
