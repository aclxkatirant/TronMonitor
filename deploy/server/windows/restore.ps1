<#
.SYNOPSIS
  TronMonitor geri yükleme (Windows): backup.ps1 arşivinden veritabanını (ve isteğe bağlı api.env'i) geri yükler.
  Mevcut veritabanı içeriği SİLİNİR ve yedektekiyle değiştirilir.
.EXAMPLE
  .\restore.ps1 -Archive C:\TronMonitor\backups\tronmonitor-20260101-031500.zip
#>
[CmdletBinding()]
param(
  [string]$InstallDir = 'C:\TronMonitor',
  [Parameter(Mandatory = $true)][string]$Archive,
  [string]$TaskPrefix = 'TronMonitor',
  [switch]$WithEnv,
  [switch]$Yes
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
Confirm-TmAdmin
$paths = Get-TmPaths $InstallDir
if (-not (Test-Path $Archive)) { Stop-TmFatal "Arşiv bulunamadı: $Archive" }
if (-not (Get-Command pg_restore -ErrorAction SilentlyContinue)) { Stop-TmFatal 'pg_restore bulunamadı.' }

$work = Join-Path ([IO.Path]::GetTempPath()) ("tm-restore-" + [IO.Path]::GetRandomFileName())
Expand-Archive -Path $Archive -DestinationPath $work
try {
  $stage = Get-ChildItem $work -Directory | Select-Object -First 1
  if (-not $stage -or -not (Test-Path (Join-Path $stage.FullName 'database.dump'))) { Stop-TmFatal 'Arşiv geçersiz: database.dump yok.' }
  Write-TmLog 'Yedek bilgisi:'; Get-Content (Join-Path $stage.FullName 'MANIFEST') -ErrorAction SilentlyContinue | ForEach-Object { "  $_" }

  if ($WithEnv) {
    New-Item -ItemType Directory -Force -Path $paths.Config | Out-Null
    Copy-Item (Join-Path $stage.FullName 'api.env') $paths.EnvFile -Force
    Write-TmLog "Ortam dosyası geri yüklendi: $($paths.EnvFile)"
  }
  if (-not (Test-Path $paths.EnvFile)) { Stop-TmFatal 'Ortam dosyası yok; -WithEnv kullanın veya önce install.ps1 çalıştırın.' }
  $envMap = Read-TmEnvFile $paths.EnvFile
  $pgUrl = $envMap['DATABASE_URL'] -replace '\?.*$', ''
  $apiPort = [int]$envMap['API_PORT']

  if (-not $Yes) {
    $answer = Read-Host 'Mevcut veritabanı içeriği silinip yedektekiyle değiştirilecek. Devam edilsin mi? [evet/hayır]'
    if ($answer -ne 'evet') { Stop-TmFatal 'İptal edildi.' }
  }

  Write-TmLog 'Görevler durduruluyor'
  Stop-TmTasks $TaskPrefix $InstallDir
  Write-TmLog 'Veritabanı geri yükleniyor'
  $dumpFile = Join-Path $stage.FullName 'database.dump'
  & pg_restore "--dbname=$pgUrl" --clean --if-exists --no-owner --no-privileges --exit-on-error $dumpFile
  if ($LASTEXITCODE -ne 0) { Stop-TmFatal 'pg_restore başarısız.' }
  Write-TmLog 'Eksik göçler uygulanıyor'
  Invoke-TmCommand (Join-Path $paths.App 'apps\api') (Get-TmNpxCmd) @('prisma', 'migrate', 'deploy') @{ DATABASE_URL = $envMap['DATABASE_URL'] }

  $agentStage = Join-Path $stage.FullName 'agent-dist'
  $agentDist = Join-Path $paths.App 'agent\dist'
  if ((Test-Path $agentStage) -and -not (Test-Path (Join-Path $agentDist 'SHA256SUMS'))) {
    Write-TmLog 'Ajan ikili dosyaları geri yükleniyor'
    New-Item -ItemType Directory -Force -Path $agentDist | Out-Null
    Copy-Item (Join-Path $agentStage '*') $agentDist -Recurse -Force
  }

  Start-TmTasks $TaskPrefix
  $health = Wait-TmHealth $apiPort 30
  if (-not $health) { Stop-TmFatal "API yanıt vermedi. Günlük: $(Join-Path $paths.Logs 'api-*.log')" }
  Write-TmLog "Geri yükleme tamamlandı: $health"
} finally {
  Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
}
