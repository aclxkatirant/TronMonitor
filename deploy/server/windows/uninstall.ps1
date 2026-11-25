<#
.SYNOPSIS
  TronMonitor kaldırma (Windows): görevler ve uygulama dizini silinir. Veritabanı, api.env ve yedekler -Purge verilmedikçe korunur.
.EXAMPLE
  .\uninstall.ps1 -Yes
.EXAMPLE
  .\uninstall.ps1 -Purge -PgAdminPassword 'postgres-parolası' -Yes
#>
[CmdletBinding()]
param(
  [string]$InstallDir = 'C:\TronMonitor',
  [string]$TaskPrefix = 'TronMonitor',
  [switch]$Purge,
  [string]$PgAdminUser = 'postgres',
  [string]$PgAdminPassword = '',
  [switch]$Yes
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
Confirm-TmAdmin
$paths = Get-TmPaths $InstallDir
$tasks = Get-TmTaskNames $TaskPrefix

if (-not $Yes) {
  $question = if ($Purge) { 'TronMonitor, veritabanı, ortam dosyası ve YEDEKLER dahil tamamen silinecek. Devam edilsin mi? [evet/hayır]' } else { 'TronMonitor görevleri ve uygulama dizini silinecek (veritabanı, ortam dosyası ve yedekler korunur). Devam edilsin mi? [evet/hayır]' }
  if ((Read-Host $question) -ne 'evet') { Stop-TmFatal 'İptal edildi.' }
}

foreach ($name in @($tasks.Web, $tasks.Api)) {
  if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
    Write-TmLog "Görev kaldırılıyor: $name"
    Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $name -Confirm:$false
  }
}
# Görevlerin başlattığı sarmalayıcı ve node süreçleri (komut satırı imzasıyla bulunur)
Stop-TmProcesses $InstallDir
Start-Sleep -Seconds 2
Get-NetFirewallRule -DisplayName "$TaskPrefix *" -ErrorAction SilentlyContinue | Remove-NetFirewallRule

$envMap = Read-TmEnvFile $paths.EnvFile
if (Test-Path $paths.App) { Write-TmLog "Uygulama dizini siliniyor: $($paths.App)"; Remove-Item $paths.App -Recurse -Force }
if (Test-Path $paths.Bin) { Remove-Item $paths.Bin -Recurse -Force }
if (Test-Path $paths.Logs) { Remove-Item $paths.Logs -Recurse -Force }

if ($Purge) {
  if ($envMap.ContainsKey('DATABASE_URL') -and $PgAdminPassword) {
    $uri = [Uri]$envMap['DATABASE_URL']
    $dbName = $uri.AbsolutePath.TrimStart('/')
    $dbUser = $uri.UserInfo.Split(':')[0]
    Write-TmLog "Veritabanı ve rol düşürülüyor: $dbName / $dbUser"
    $env:PGPASSWORD = $PgAdminPassword
    try {
      & psql -h $uri.Host -p $uri.Port -U $PgAdminUser -d postgres -c "DROP DATABASE IF EXISTS ""$dbName"";" | Out-Null
      & psql -h $uri.Host -p $uri.Port -U $PgAdminUser -d postgres -c "DROP ROLE IF EXISTS ""$dbUser"";" | Out-Null
    } finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
  } elseif ($envMap.ContainsKey('DATABASE_URL')) {
    Write-TmWarn 'Veritabanını düşürmek için -PgAdminPassword gerekir; veritabanı korunuyor.'
  }
  if (Test-Path $paths.Root) { Remove-Item $paths.Root -Recurse -Force }
  Write-TmLog 'Tamamen kaldırıldı.'
} else {
  Write-TmLog "Kaldırıldı. Korunanlar: veritabanı, $($paths.EnvFile), $($paths.Backups)"
}
