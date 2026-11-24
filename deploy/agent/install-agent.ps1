<#
.SYNOPSIS
  TronMonitor Agent kurulum betiği (Windows Server 2019 / 2022 / 2025).
.EXAMPLE
  .\install-agent.ps1 -Server https://tron.kurum.com -Token tmr_XXXX
.PARAMETER ServiceUser
  Hizmetin çalışacağı hesap (boş: LocalSystem).
.PARAMETER CaFile
  Özel CA sertifikası (PEM) yolu.
.PARAMETER AllowHttp
  Yalnızca test ortamı: düz HTTP'ye izin verir.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Server,
  [Parameter(Mandatory = $true)][string]$Token,
  [string]$ServiceUser = "",
  [string]$CaFile = "",
  [switch]$AllowHttp,
  [string]$InstallDir = "$env:ProgramFiles\TronMonitor\Agent"
)

$ErrorActionPreference = "Stop"
function Write-Step($msg) { Write-Host "[TronMonitor] $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Host "[TronMonitor] Hata: $msg" -ForegroundColor Red; exit 1 }

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Fail "Bu betik yönetici PowerShell oturumunda çalıştırılmalıdır." }

$Server = $Server.TrimEnd('/')
if ($Server -like "http://*") {
  if (-not $AllowHttp) { Fail "Sunucu adresi HTTPS olmalıdır. Yalnızca test ortamında -AllowHttp kullanın." }
} elseif ($Server -notlike "https://*") {
  Fail "Sunucu adresi http:// veya https:// ile başlamalıdır."
}
if ($Token -notlike "tmr_*") { Fail "Kayıt belirteci 'tmr_' ile başlamalıdır." }

$build = [System.Environment]::OSVersion.Version
if ($build.Major -lt 10 -or ($build.Major -eq 10 -and $build.Build -lt 17763)) {
  Fail "Desteklenmeyen Windows sürümü: $build. En az Windows Server 2019 (10.0.17763) gerekir."
}

$arch = switch ($env:PROCESSOR_ARCHITECTURE) {
  "AMD64" { "amd64" }
  "ARM64" { "arm64" }
  default { Fail "Desteklenmeyen mimari: $env:PROCESSOR_ARCHITECTURE" }
}
$binary = "tronmonitor-agent-windows-$arch.exe"

# Windows Server 2019'da TLS 1.2 açıkça etkinleştirilmelidir.
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$tmp = Join-Path $env:TEMP ("tronmonitor-agent-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force $tmp | Out-Null
try {
  Write-Step "İşletim sistemi: $((Get-CimInstance Win32_OperatingSystem).Caption) · mimari: $arch"
  Write-Step "Ajan indiriliyor: $Server/api/v1/agent-downloads/$binary"
  Invoke-WebRequest -UseBasicParsing -Uri "$Server/api/v1/agent-downloads/$binary" -OutFile (Join-Path $tmp $binary)
  Invoke-WebRequest -UseBasicParsing -Uri "$Server/api/v1/agent-downloads/SHA256SUMS" -OutFile (Join-Path $tmp "SHA256SUMS")

  Write-Step "Bütünlük doğrulanıyor (SHA-256)"
  $line = Get-Content (Join-Path $tmp "SHA256SUMS") | Where-Object { $_ -match "\s\*?$([regex]::Escape($binary))$" } | Select-Object -First 1
  if (-not $line) { Fail "SHA256SUMS dosyasında $binary için özet bulunamadı." }
  $expected = ($line -split "\s+")[0].ToLower()
  $actual = (Get-FileHash (Join-Path $tmp $binary) -Algorithm SHA256).Hash.ToLower()
  if ($expected -ne $actual) { Fail "Özet uyuşmuyor! Beklenen $expected, bulunan $actual. İndirilen dosya çalıştırılmadı." }

  $target = Join-Path $InstallDir "tronmonitor-agent.exe"
  if (Test-Path $target) {
    Write-Step "Mevcut hizmet durduruluyor"
    & $target service stop 2>$null | Out-Null
  }
  New-Item -ItemType Directory -Force $InstallDir | Out-Null
  Copy-Item (Join-Path $tmp $binary) $target -Force
  Copy-Item (Join-Path $tmp "SHA256SUMS") (Join-Path $InstallDir "SHA256SUMS") -Force
  Write-Step "Ajan $target konumuna kuruldu ($(& $target version))"

  # Yapılandırma dizini: yalnızca yöneticiler ve SYSTEM (ve varsa hizmet hesabı) erişebilir.
  $cfgDir = Join-Path $env:ProgramData "TronMonitor\Agent"
  New-Item -ItemType Directory -Force $cfgDir | Out-Null
  icacls $cfgDir /inheritance:r /grant:r "SYSTEM:(OI)(CI)F" "Administrators:(OI)(CI)F" | Out-Null
  if ($ServiceUser) { icacls $cfgDir /grant:r "$($ServiceUser):(OI)(CI)M" | Out-Null }

  $args = @("install", "--server", $Server, "--token", $Token, "--force")
  if ($AllowHttp) { $args += "--allow-http" }
  if ($CaFile) { $args += @("--ca-file", $CaFile) }
  if ($ServiceUser) { $args += @("--service-user", $ServiceUser) }

  Write-Step "Sunucu kaydediliyor ve hizmet kuruluyor"
  & $target @args
  if ($LASTEXITCODE -ne 0) { Fail "Kayıt veya hizmet kurulumu başarısız oldu (çıkış kodu $LASTEXITCODE)." }

  Write-Step "Kurulum tamamlandı. Durum:"
  & $target status
  Get-Service tronmonitor-agent | Format-Table Name, Status, StartType -AutoSize
}
finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
