<#
.SYNOPSIS
  TronMonitor merkezi sunucu kurulumu (Windows Server 2019 / 2022 / 2025).

.DESCRIPTION
  Ön koşullar (bu betik kurmaz): Node.js 22+, PostgreSQL 14+ (psql ve pg_dump PATH'te), Redis uyumlu sunucu
  (ör. Memurai) — bkz. docs/kurulum.md. API ve web, Görev Zamanlayıcı görevleri olarak LocalService hesabıyla çalışır.

  İki çalışma modu:
  - Ters vekil modu (-PublicUrl https://tron.kurum.com): web ve API yalnızca 127.0.0.1'de dinler; HTTPS'i IIS (ARR)
    veya Nginx üstlenir (deploy/server/nginx/tronmonitor.conf). Üretim için önerilen mod.
  - Basit mod (-PublicUrl verilmezse): pano http://<sunucu-adı>:<WebPort> üzerinden, WebSocket'ler doğrudan
    <ApiPort> üzerinden sunulur; HTTPS yoktur, yalnızca kapalı iç ağ için.

.EXAMPLE
  .\install.ps1 -PublicUrl https://tron.kurum.com -PgAdminPassword 'postgres-parolası'
.EXAMPLE
  .\install.ps1 -DatabaseUrl 'postgresql://tronmonitor:parola@127.0.0.1:5432/tronmonitor' -OpenFirewall
#>
[CmdletBinding()]
param(
  [string]$InstallDir = 'C:\TronMonitor',
  [string]$Source = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path,
  [string]$PublicUrl = '',
  [int]$ApiPort = 4000,
  [int]$WebPort = 3000,
  [string]$DatabaseUrl = '',
  [string]$PgHost = '127.0.0.1',
  [int]$PgPort = 5432,
  [string]$PgAdminUser = 'postgres',
  [string]$PgAdminPassword = '',
  [string]$DbName = 'tronmonitor',
  [string]$DbUser = 'tronmonitor',
  [string]$RedisUrl = 'redis://127.0.0.1:6379',
  [string]$ServiceAccount = 'NT AUTHORITY\LocalService',
  [string]$TaskPrefix = 'TronMonitor',
  [switch]$OpenFirewall,
  [switch]$SkipAgentBuild
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
Confirm-TmAdmin

# ---------------------------------------------------------------------------
# 1) Ön koşullar
# ---------------------------------------------------------------------------
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Stop-TmFatal 'Node.js bulunamadı. https://nodejs.org adresinden 22 LTS kurun ve PowerShell''i yeniden açın.' }
$nodeMajor = [int]((& node -v).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 22) { Stop-TmFatal "Node.js 22+ gerekli (bulunan: $(& node -v))." }
if (-not (Get-Command psql -ErrorAction SilentlyContinue)) { Stop-TmFatal 'psql bulunamadı. PostgreSQL bin dizinini PATH''e ekleyin (ör. C:\Program Files\PostgreSQL\17\bin).' }
$redisUri = [Uri]$RedisUrl
if (-not (Test-TmTcp $redisUri.Host $redisUri.Port)) { Stop-TmFatal "Redis'e ulaşılamadı: $RedisUrl (Memurai hizmeti çalışıyor mu?)" }
if (-not (Test-Path (Join-Path $Source 'package.json'))) { Stop-TmFatal "Kaynak dizin geçersiz: $Source" }
if (-not (Test-TmTcp $PgHost $PgPort)) { Stop-TmFatal "PostgreSQL'e ulaşılamadı: ${PgHost}:${PgPort}" }

$simpleMode = [string]::IsNullOrWhiteSpace($PublicUrl)
$hostName = [Net.Dns]::GetHostName()
if ($simpleMode) { $webOrigin = "http://${hostName}:${WebPort}" } else { $webOrigin = $PublicUrl.TrimEnd('/') }
$paths = Get-TmPaths $InstallDir
$tasks = Get-TmTaskNames $TaskPrefix

# ---------------------------------------------------------------------------
# 2) Dizinler ve kaynak kopyası
# ---------------------------------------------------------------------------
foreach ($dir in @($paths.Root, $paths.App, $paths.Config, $paths.Bin, $paths.Logs, $paths.Backups)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
Write-TmLog "Kaynak kopyalanıyor: $Source -> $($paths.App)"
$existingTask = Get-ScheduledTask -TaskName $tasks.Api -ErrorAction SilentlyContinue
if ($existingTask) { Write-TmLog 'Mevcut kurulum bulundu; görevler durduruluyor'; Stop-TmTasks $TaskPrefix $InstallDir }
$robocopyArgs = @($Source, $paths.App, '/MIR', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:2', '/W:2',
  '/XD', 'node_modules', '.git', '.gocache', (Join-Path $Source 'apps\api\dist'), (Join-Path $Source 'apps\web\.next'), (Join-Path $Source 'apps\api\src\generated'),
  '/XF', '.env', '.env.local', '.env.production', '.env.development')
& robocopy @robocopyArgs | Out-Null
if ($LASTEXITCODE -ge 8) { Stop-TmFatal "robocopy başarısız (kod $LASTEXITCODE)" }
Copy-Item (Join-Path $paths.App 'deploy\server\windows\common.ps1') $paths.Bin -Force
Copy-Item (Join-Path $paths.App 'deploy\server\windows\run-service.ps1') $paths.Bin -Force

# ---------------------------------------------------------------------------
# 3) Veritabanı
# ---------------------------------------------------------------------------
$existingEnv = Read-TmEnvFile $paths.EnvFile
if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) {
  if ($existingEnv.ContainsKey('DATABASE_URL')) {
    $DatabaseUrl = $existingEnv['DATABASE_URL']
    Write-TmLog 'Mevcut DATABASE_URL korunuyor'
  } else {
    if ([string]::IsNullOrWhiteSpace($PgAdminPassword)) { Stop-TmFatal 'Veritabanı oluşturmak için -PgAdminPassword verin ya da hazır bir -DatabaseUrl kullanın.' }
    $dbPassword = New-TmRandomHex 24
    $env:PGPASSWORD = $PgAdminPassword
    try {
      $roleExists = (& psql -h $PgHost -p $PgPort -U $PgAdminUser -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DbUser'").Trim()
      if ($LASTEXITCODE -ne 0) { Stop-TmFatal 'PostgreSQL yönetici bağlantısı başarısız (parola veya pg_hba ayarlarını denetleyin).' }
      if ($roleExists -ne '1') {
        Write-TmLog "PostgreSQL rolü oluşturuluyor: $DbUser"
        & psql -h $PgHost -p $PgPort -U $PgAdminUser -d postgres -v ON_ERROR_STOP=1 -c "CREATE ROLE ""$DbUser"" LOGIN PASSWORD '$dbPassword';" | Out-Null
      } else {
        & psql -h $PgHost -p $PgPort -U $PgAdminUser -d postgres -v ON_ERROR_STOP=1 -c "ALTER ROLE ""$DbUser"" PASSWORD '$dbPassword';" | Out-Null
      }
      $dbExists = (& psql -h $PgHost -p $PgPort -U $PgAdminUser -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DbName'").Trim()
      if ($dbExists -ne '1') {
        Write-TmLog "Veritabanı oluşturuluyor: $DbName"
        & psql -h $PgHost -p $PgPort -U $PgAdminUser -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE ""$DbName"" OWNER ""$DbUser"" ENCODING 'UTF8';" | Out-Null
      }
    } finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
    $DatabaseUrl = "postgresql://${DbUser}:${dbPassword}@${PgHost}:${PgPort}/${DbName}"
  }
}

# ---------------------------------------------------------------------------
# 4) Ortam dosyası (mevcutsa sırlar korunur)
# ---------------------------------------------------------------------------
if (-not (Test-Path $paths.EnvFile)) {
  Write-TmLog "Ortam dosyası yazılıyor: $($paths.EnvFile)"
  $apiHost = if ($simpleMode) { '0.0.0.0' } else { '127.0.0.1' }
  $cookieLine = if ($simpleMode) { 'COOKIE_SECURE=false' } else { '' }
  $content = @(
    '# TronMonitor API üretim ortamı — bu dosya sır içerir; yalnızca yöneticiler ve hizmet hesabı okuyabilmelidir.',
    'NODE_ENV=production',
    "API_HOST=$apiHost",
    "API_PORT=$ApiPort",
    "WEB_ORIGIN=$webOrigin",
    "DATABASE_URL=$DatabaseUrl",
    "REDIS_URL=$RedisUrl",
    "SESSION_SECRET=$(New-TmRandomBase64 48)",
    "ENCRYPTION_KEY=$(New-TmRandomBase64 32)",
    'SESSION_TTL_HOURS=24',
    'LOG_LEVEL=info',
    $cookieLine,
    "AGENT_RELEASES_DIR=$(Join-Path $paths.App 'agent\dist')",
    "AGENT_SCRIPTS_DIR=$(Join-Path $paths.App 'deploy\agent')",
    "WEB_PORT_INTERNAL=$WebPort",
    "WEB_HOST_INTERNAL=$(if ($simpleMode) { '0.0.0.0' } else { '127.0.0.1' })"
  ) | Where-Object { $_ -ne '' }
  [IO.File]::WriteAllLines($paths.EnvFile, $content, (New-Object Text.UTF8Encoding $false))
} else {
  Write-TmLog "Mevcut ortam dosyası korunuyor: $($paths.EnvFile)"
}
$envMap = Read-TmEnvFile $paths.EnvFile
$ApiPort = [int]$envMap['API_PORT']

# Basit modda tarayıcı WebSocket'leri doğrudan API portuna gider (Next.js yeniden yazmaları WebSocket taşımaz).
$webEnvFile = Join-Path $paths.App 'apps\web\.env.production'
if ($simpleMode) {
  [IO.File]::WriteAllLines($webEnvFile, @("NEXT_PUBLIC_WS_URL=ws://${hostName}:${ApiPort}/api/v1/ws"), (New-Object Text.UTF8Encoding $false))
} elseif (Test-Path $webEnvFile) { Remove-Item $webEnvFile }

# ---------------------------------------------------------------------------
# 5) Bağımlılıklar, derleme, şema
# ---------------------------------------------------------------------------
$npm = Get-TmNpmCmd; $npx = Get-TmNpxCmd
Write-TmLog 'npm bağımlılıkları kuruluyor (birkaç dakika sürebilir)'
Invoke-TmCommand $paths.App $npm @('ci', '--no-audit', '--no-fund', '--loglevel=error') @{ DATABASE_URL = $DatabaseUrl }
Write-TmLog 'API ve web derleniyor'
Invoke-TmCommand $paths.App $npm @('run', 'build', '--workspace', 'apps/api', '--workspace', 'apps/web', '--loglevel=error') @{ NODE_ENV = 'production'; DATABASE_URL = $DatabaseUrl }
Write-TmLog 'Veritabanı şeması uygulanıyor'
Invoke-TmCommand (Join-Path $paths.App 'apps\api') $npx @('prisma', 'migrate', 'deploy') @{ DATABASE_URL = $DatabaseUrl }

if (-not $SkipAgentBuild) {
  if (Get-Command go -ErrorAction SilentlyContinue) {
    Write-TmLog 'Ajan ikili dosyaları derleniyor'
    $appVersion = (Get-Content (Join-Path $paths.App 'package.json') -Raw | ConvertFrom-Json).version
    Invoke-TmCommand (Join-Path $paths.App 'agent') 'powershell.exe' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', '.\build.ps1', '-Version', $appVersion)
  } elseif (-not (Test-Path (Join-Path $paths.App 'agent\dist\SHA256SUMS'))) {
    Write-TmWarn "Go bulunamadı ve agent\dist boş: ajan indirme uçları çalışmaz. Ajanı başka bir makinede derleyip (agent\build.ps1) dist içeriğini $(Join-Path $paths.App 'agent\dist') dizinine kopyalayın."
  }
}

# ---------------------------------------------------------------------------
# 6) İzinler ve görevler
# ---------------------------------------------------------------------------
Write-TmLog "Dizin izinleri veriliyor ($ServiceAccount)"
& icacls $paths.Root /grant "*S-1-5-32-544:(OI)(CI)F" /Q | Out-Null                       # Yöneticiler: tam
& icacls $paths.App /grant "${ServiceAccount}:(OI)(CI)RX" /Q | Out-Null                        # uygulama: okuma/çalıştırma (alt öğeler kalıtımla alır)
& icacls (Join-Path $paths.App 'apps\web\.next') /grant "${ServiceAccount}:(OI)(CI)M" /Q | Out-Null
& icacls $paths.Logs /grant "${ServiceAccount}:(OI)(CI)M" /Q | Out-Null
& icacls $paths.Config /inheritance:r /grant "*S-1-5-32-544:(OI)(CI)F" "*S-1-5-18:(OI)(CI)F" "${ServiceAccount}:(OI)(CI)R" /Q | Out-Null
& icacls $paths.Bin /grant "${ServiceAccount}:(OI)(CI)RX" /Q | Out-Null

Write-TmLog 'Görev Zamanlayıcı görevleri kuruluyor'
$runner = Join-Path $paths.Bin 'run-service.ps1'
foreach ($role in @('api', 'web')) {
  $name = if ($role -eq 'api') { $tasks.Api } else { $tasks.Web }
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runner`" -Role $role -InstallDir `"$InstallDir`""
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  $principal = New-ScheduledTaskPrincipal -UserId $ServiceAccount -LogonType ServiceAccount -RunLevel Limited
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
  Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "TronMonitor $role ($InstallDir)" | Out-Null
}
Start-TmTasks $TaskPrefix

if ($OpenFirewall) {
  Write-TmLog 'Güvenlik duvarı kuralları ekleniyor'
  $ports = if ($simpleMode) { @($WebPort, $ApiPort) } else { @(80, 443) }
  foreach ($p in $ports) {
    $ruleName = "$TaskPrefix $p"
    if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
      New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP -LocalPort $p -Action Allow | Out-Null
    }
  }
}

# ---------------------------------------------------------------------------
# 7) Sağlık denetimi
# ---------------------------------------------------------------------------
Write-TmLog 'API sağlık denetimi bekleniyor'
$health = Wait-TmHealth $ApiPort 30
if (-not $health) { Stop-TmFatal "API yanıt vermedi. Günlük: $(Join-Path $paths.Logs 'api-*.log')" }
Write-TmLog "API sağlıklı: $health"
if (-not (Wait-TmHealthWeb $WebPort)) { Write-TmWarn "Web arayüzü henüz yanıt vermedi; günlük: $(Join-Path $paths.Logs 'web-*.log')" }

Write-Host ''
Write-Host 'TronMonitor kuruldu.'
Write-Host "  Pano:            $webOrigin"
Write-Host "  İlk kurulum:     $webOrigin/kurulum  (ilk hesap süper yönetici olur)"
Write-Host "  Uygulama dizini: $($paths.App)"
Write-Host "  Ortam dosyası:   $($paths.EnvFile)  (sırlar; yedekleyin)"
Write-Host "  Günlükler:       $($paths.Logs)"
Write-Host "  Görevler:        '$($tasks.Api)', '$($tasks.Web)' (Görev Zamanlayıcı)"
Write-Host "  Güncelleme:      $(Join-Path $paths.App 'deploy\server\windows\update.ps1')"
Write-Host "  Yedekleme:       $(Join-Path $paths.App 'deploy\server\windows\backup.ps1')"
if (-not $simpleMode) { Write-Host "  Ters vekil:      $webOrigin adresini 127.0.0.1:$WebPort (web) ve /api/ -> 127.0.0.1:$ApiPort (WebSocket dahil) olarak yönlendirin; bkz. docs/kurulum.md" }
