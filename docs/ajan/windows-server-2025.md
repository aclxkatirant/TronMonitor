# Windows Server 2025 Ajan Kurulumu

> Uyumluluk durumu: **doğrulanmadı**. Aynı ikili dosya Windows 11 Pro (10.0.26300; Server 2025 ile aynı çekirdek nesli) üzerinde hizmet olarak doğrulanmıştır; Windows Server 2025 (10.0.26100) üzerinde test edilene kadar "doğrulanmış" olarak işaretlenmez.

Kurulum adımları [Windows Server 2019 kılavuzu](windows-server-2019.md) ile aynıdır:

```powershell
& "C:\Program Files\TronMonitor\Agent\tronmonitor-agent-windows-amd64.exe" install --server https://tron.kurum.com --token tmr_XXXXXXXX
Get-Service tronmonitor-agent
```

## Windows Server 2025'e özgü notlar

- ARM64 sürümleri için `tronmonitor-agent-windows-arm64.exe` kullanılır (henüz gerçek ARM64 donanımında doğrulanmadı).
- Hotpatch etkin kurulumlarda hizmet yeniden başlatma gerektirmez; ajan güncellemeleri hizmetin kısa süreli durdurulmasını gerektirir.

Kaldırma ve sorun giderme için [genel ajan kılavuzuna](README.md) bakın.
