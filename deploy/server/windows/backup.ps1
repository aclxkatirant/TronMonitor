<#
.SYNOPSIS
  TronMonitor yedekleme (Windows): PostgreSQL dökümü (pg_dump özel biçim), api.env ve ajan ikili dosyaları tek bir .zip içinde.
.DESCRIPTION
  Varsayılan hedef: <InstallDir>\backups. -Keep ile en yeni N yedek dışındakiler silinir (0 = silme).
  Düzenli yedek için Görev Zamanlayıcı'da günlük bir görev oluşturun (bkz. docs/isletim.md).
.EXAMPLE
  .\backup.ps1 -Keep 14
#>
[CmdletBinding()]
param(
  [string]$InstallDir = 'C:\TronMonitor',
  [string]$Destination = '',
  [int]$Keep = 14,
  [string]$Label = ''
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
Confirm-TmAdmin
$paths = Get-TmPaths $InstallDir
if (-not (Test-Path $paths.EnvFile)) { Stop-TmFatal "Kurulum bulunamadı: $($paths.EnvFile) yok." }
if (-not (Get-Command pg_dump -ErrorAction SilentlyContinue)) { Stop-TmFatal 'pg_dump bulunamadı (PostgreSQL bin dizinini PATH''e ekleyin).' }
if ([string]::IsNullOrWhiteSpace($Destination)) { $Destination = $paths.Backups }
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
$envMap = Read-TmEnvFile $paths.EnvFile
# pg_dump/pg_restore URI sorgu parametrelerini (ör. ?schema=public) kabul etmez.
$pgUrl = $envMap['DATABASE_URL'] -replace '\?.*$', ''

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$name = "tronmonitor-$stamp" + $(if ($Label) { "-$Label" } else { '' })
$work = Join-Path ([IO.Path]::GetTempPath()) ("tm-backup-" + [IO.Path]::GetRandomFileName())
$stage = Join-Path $work $name
New-Item -ItemType Directory -Force -Path $stage | Out-Null
try {
  Write-TmLog 'Veritabanı dökümü alınıyor'
  $dumpFile = Join-Path $stage 'database.dump'
  & pg_dump "--dbname=$pgUrl" --format=custom --no-owner --no-privileges "--file=$dumpFile"
  if ($LASTEXITCODE -ne 0) { Stop-TmFatal 'pg_dump başarısız.' }
  Copy-Item $paths.EnvFile (Join-Path $stage 'api.env')
  $agentDist = Join-Path $paths.App 'agent\dist'
  if (Test-Path $agentDist) { Copy-Item $agentDist (Join-Path $stage 'agent-dist') -Recurse }
  $version = try { (Get-Content (Join-Path $paths.App 'package.json') -Raw | ConvertFrom-Json).version } catch { 'bilinmiyor' }
  @("tronmonitor-backup=1", "created=$(Get-Date -Format o)", "host=$([Net.Dns]::GetHostName())", "app_version=$version") | Set-Content (Join-Path $stage 'MANIFEST') -Encoding UTF8

  $archive = Join-Path $Destination "$name.zip"
  Compress-Archive -Path $stage -DestinationPath $archive -CompressionLevel Optimal
  & icacls $archive /inheritance:r /grant "*S-1-5-32-544:F" "*S-1-5-18:F" /Q | Out-Null
  Write-TmLog "Yedek yazıldı: $archive ($([math]::Round((Get-Item $archive).Length / 1MB, 1)) MB)"
} finally {
  Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
}

if ($Keep -gt 0) {
  Get-ChildItem $Destination -Filter 'tronmonitor-*.zip' | Sort-Object LastWriteTime -Descending | Select-Object -Skip $Keep | ForEach-Object {
    Write-TmLog "Eski yedek siliniyor: $($_.FullName)"
    Remove-Item $_.FullName -Force
  }
}
