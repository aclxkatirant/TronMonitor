<#
.SYNOPSIS
  TronMonitor güncelleme (Windows): yedek alır, yeni kaynağı kopyalar, derler, veritabanı göçlerini uygular, görevleri yeniden başlatır.
.EXAMPLE
  .\update.ps1 -Source C:\Kaynak\TronMonitor
#>
[CmdletBinding()]
param(
  [string]$InstallDir = 'C:\TronMonitor',
  [Parameter(Mandatory = $true)][string]$Source,
  [string]$TaskPrefix = 'TronMonitor',
  [switch]$NoBackup,
  [switch]$SkipAgentBuild
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
Confirm-TmAdmin
$paths = Get-TmPaths $InstallDir
if (-not (Test-Path $paths.EnvFile)) { Stop-TmFatal "Kurulum bulunamadı: $($paths.EnvFile) yok." }
if (-not (Test-Path (Join-Path $Source 'package.json'))) { Stop-TmFatal "Kaynak dizin geçersiz: $Source" }
$envMap = Read-TmEnvFile $paths.EnvFile
$apiPort = [int]$envMap['API_PORT']

if (-not $NoBackup) {
  Write-TmLog 'Güncelleme öncesi yedek alınıyor'
  & (Join-Path $PSScriptRoot 'backup.ps1') -InstallDir $InstallDir -Label 'pre-update'
}

Write-TmLog 'Görevler durduruluyor'
Stop-TmTasks $TaskPrefix $InstallDir

Write-TmLog "Kaynak kopyalanıyor: $Source -> $($paths.App)"
$webEnvBackup = $null
$webEnvFile = Join-Path $paths.App 'apps\web\.env.production'
if (Test-Path $webEnvFile) { $webEnvBackup = Get-Content $webEnvFile -Raw }
$robocopyArgs = @($Source, $paths.App, '/MIR', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:2', '/W:2',
  '/XD', 'node_modules', '.git', '.gocache', (Join-Path $Source 'apps\api\dist'), (Join-Path $Source 'apps\web\.next'), (Join-Path $Source 'apps\api\src\generated'), (Join-Path $Source 'agent\dist'),
  '/XF', '.env', '.env.local', '.env.production', '.env.development')
& robocopy @robocopyArgs | Out-Null
if ($LASTEXITCODE -ge 8) { Stop-TmFatal "robocopy başarısız (kod $LASTEXITCODE)" }
if ($webEnvBackup) { [IO.File]::WriteAllText($webEnvFile, $webEnvBackup, (New-Object Text.UTF8Encoding $false)) }
Copy-Item (Join-Path $paths.App 'deploy\server\windows\common.ps1') $paths.Bin -Force
Copy-Item (Join-Path $paths.App 'deploy\server\windows\run-service.ps1') $paths.Bin -Force

$npm = Get-TmNpmCmd; $npx = Get-TmNpxCmd
Write-TmLog 'npm bağımlılıkları kuruluyor'
Invoke-TmCommand $paths.App $npm @('ci', '--no-audit', '--no-fund', '--loglevel=error') @{ DATABASE_URL = $envMap['DATABASE_URL'] }
Write-TmLog 'API ve web derleniyor'
Invoke-TmCommand $paths.App $npm @('run', 'build', '--workspace', 'apps/api', '--workspace', 'apps/web', '--loglevel=error') @{ NODE_ENV = 'production'; DATABASE_URL = $envMap['DATABASE_URL'] }
Write-TmLog 'Veritabanı göçleri uygulanıyor'
Invoke-TmCommand (Join-Path $paths.App 'apps\api') $npx @('prisma', 'migrate', 'deploy') @{ DATABASE_URL = $envMap['DATABASE_URL'] }
if (-not $SkipAgentBuild -and (Get-Command go -ErrorAction SilentlyContinue)) {
  Write-TmLog 'Ajan ikili dosyaları derleniyor'
  $appVersion = (Get-Content (Join-Path $paths.App 'package.json') -Raw | ConvertFrom-Json).version
  Invoke-TmCommand (Join-Path $paths.App 'agent') 'powershell.exe' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', '.\build.ps1', '-Version', $appVersion)
}

$serviceAccount = ((Get-ScheduledTask -TaskName (Get-TmTaskNames $TaskPrefix).Api).Principal.UserId)
& icacls $paths.App /grant "${serviceAccount}:(OI)(CI)RX" /Q | Out-Null
& icacls (Join-Path $paths.App 'apps\web\.next') /grant "${serviceAccount}:(OI)(CI)M" /Q | Out-Null

Write-TmLog 'Görevler başlatılıyor'
Start-TmTasks $TaskPrefix
$health = Wait-TmHealth $apiPort 30
if (-not $health) { Stop-TmFatal "API yanıt vermedi. Günlük: $(Join-Path $paths.Logs 'api-*.log'). Gerekirse restore.ps1 ile yedeğe dönün." }
Write-TmLog "Güncelleme tamamlandı: $health"
