# TronMonitor Windows merkezi sunucu betiklerinin ortak parçası. Doğrudan çalıştırılmaz.
# Hedef: Windows Server 2019 / 2022 / 2025 (Windows PowerShell 5.1 veya PowerShell 7). Yönetici gerekir.
#
# API ve web, Görev Zamanlayıcı görevleri olarak çalışır (sistem açılışında başlar, çökünce yeniden başlar).
# Bu yaklaşım ek araç (NSSM/WinSW) indirmeyi gerektirmez. Ters vekil (IIS ARR veya Nginx) isteğe bağlıdır.

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function Write-TmLog($Message) { Write-Host "[tronmonitor] $Message" -ForegroundColor Cyan }
function Write-TmWarn($Message) { Write-Host "[tronmonitor] UYARI: $Message" -ForegroundColor Yellow }
function Stop-TmFatal($Message) { Write-Host "[tronmonitor] HATA: $Message" -ForegroundColor Red; exit 1 }

function Test-TmAdmin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Confirm-TmAdmin {
  if (-not (Test-TmAdmin)) { Stop-TmFatal 'Bu betik yönetici olarak çalıştırılmalıdır (PowerShell''i "Yönetici olarak çalıştır").' }
}

function Get-TmPaths($InstallDir) {
  return [pscustomobject]@{
    Root     = $InstallDir
    App      = Join-Path $InstallDir 'app'
    Config   = Join-Path $InstallDir 'config'
    EnvFile  = Join-Path $InstallDir 'config\api.env'
    Bin      = Join-Path $InstallDir 'bin'
    Logs     = Join-Path $InstallDir 'logs'
    Backups  = Join-Path $InstallDir 'backups'
  }
}

# api.env dosyasını okur (KEY=VALUE; # ile başlayan satırlar yorumdur).
function Read-TmEnvFile($Path) {
  $map = @{}
  if (-not (Test-Path $Path)) { return $map }
  foreach ($line in Get-Content $Path -Encoding UTF8) {
    if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
    $idx = $line.IndexOf('=')
    $key = $line.Substring(0, $idx).Trim()
    $value = $line.Substring($idx + 1).Trim()
    if ($value.StartsWith('"') -and $value.EndsWith('"') -and $value.Length -ge 2) { $value = $value.Substring(1, $value.Length - 2) }
    $map[$key] = $value
  }
  return $map
}

function New-TmRandomBase64($Bytes) {
  $buffer = New-Object byte[] $Bytes
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buffer)
  return [Convert]::ToBase64String($buffer)
}

function New-TmRandomHex($Bytes) {
  $buffer = New-Object byte[] $Bytes
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buffer)
  return ($buffer | ForEach-Object { $_.ToString('x2') }) -join ''
}

function Test-TmTcp($HostName, $Port, $TimeoutMs = 2000) {
  try {
    $client = New-Object Net.Sockets.TcpClient
    $async = $client.BeginConnect($HostName, $Port, $null, $null)
    $ok = $async.AsyncWaitHandle.WaitOne($TimeoutMs, $false)
    if ($ok) { $client.EndConnect($async) }
    $client.Close()
    return $ok
  } catch { return $false }
}

function Get-TmHealth($Port) {
  try {
    $resp = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/api/v1/health" -TimeoutSec 5
    return $resp.Content
  } catch { return $null }
}

function Wait-TmHealth($Port, $Tries = 30) {
  for ($i = 0; $i -lt $Tries; $i++) {
    $health = Get-TmHealth $Port
    if ($health) { return $health }
    Start-Sleep -Seconds 2
  }
  return $null
}

function Wait-TmHealthWeb($Port, $Tries = 30) {
  for ($i = 0; $i -lt $Tries; $i++) {
    try {
      $resp = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/giris" -TimeoutSec 5
      if ($resp.StatusCode -eq 200) { return $true }
    } catch { }
    Start-Sleep -Seconds 2
  }
  return $false
}

# Komutu belirtilen dizinde çalıştırır; sıfır dışı çıkış kodunda hata verir.
function Invoke-TmCommand($WorkingDirectory, $FilePath, [string[]]$Arguments, [hashtable]$Environment = @{}) {
  $old = @{}
  foreach ($k in $Environment.Keys) { $old[$k] = [Environment]::GetEnvironmentVariable($k, 'Process'); [Environment]::SetEnvironmentVariable($k, $Environment[$k], 'Process') }
  try {
    Push-Location $WorkingDirectory
    try {
      & $FilePath @Arguments
      if ($LASTEXITCODE -ne 0) { throw "Komut başarısız ($LASTEXITCODE): $FilePath $($Arguments -join ' ')" }
    } finally { Pop-Location }
  } finally {
    foreach ($k in $old.Keys) { [Environment]::SetEnvironmentVariable($k, $old[$k], 'Process') }
  }
}

function Get-TmNpmCmd { $cmd = Get-Command npm.cmd -ErrorAction SilentlyContinue; if ($cmd) { return $cmd.Source }; return (Get-Command npm).Source }
function Get-TmNpxCmd { $cmd = Get-Command npx.cmd -ErrorAction SilentlyContinue; if ($cmd) { return $cmd.Source }; return (Get-Command npx).Source }

# Görev adları; -TaskPrefix ile birden fazla kurulum (ör. test) yan yana durabilir.
function Get-TmTaskNames($Prefix) {
  return [pscustomobject]@{ Api = "$Prefix API"; Web = "$Prefix Web" }
}

# Görevlerin başlattığı sarmalayıcı ve node süreçlerini bulur (komut satırındaki --title imzası ve betik yolu ile).
function Get-TmProcesses($InstallDir) {
  $marker = "@$InstallDir"
  $runner = Join-Path $InstallDir 'bin\run-service.ps1'
  return Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and ($_.CommandLine -like "*--title=TronMonitor-*$marker*" -or $_.CommandLine -like "*$runner*") }
}

function Stop-TmProcesses($InstallDir) {
  Get-TmProcesses $InstallDir | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

function Stop-TmTasks($Prefix, $InstallDir) {
  $names = Get-TmTaskNames $Prefix
  foreach ($name in @($names.Web, $names.Api)) {
    $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
    if ($task) {
      Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
      Disable-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue | Out-Null
    }
  }
  # Görev durdurulsa da alt node süreçleri kalabilir; imzayla bulunup kapatılır.
  if ($InstallDir) { Stop-TmProcesses $InstallDir }
  Start-Sleep -Seconds 2
}

function Start-TmTasks($Prefix) {
  $names = Get-TmTaskNames $Prefix
  foreach ($name in @($names.Api, $names.Web)) {
    Enable-ScheduledTask -TaskName $name | Out-Null
    Start-ScheduledTask -TaskName $name
  }
}
