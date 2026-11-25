# Görev Zamanlayıcı tarafından çalıştırılan sarmalayıcı: ortam dosyasını yükler, Node sürecini başlatır,
# çıktıyı günlük dosyasına yazar ve süreç beklenmedik biçimde biterse yeniden başlatır.
# Kullanım: run-service.ps1 -Role api|web -InstallDir C:\TronMonitor
param(
  [Parameter(Mandatory = $true)][ValidateSet('api', 'web')][string]$Role,
  [Parameter(Mandatory = $true)][string]$InstallDir
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
$paths = Get-TmPaths $InstallDir
$envMap = Read-TmEnvFile $paths.EnvFile
$node = (Get-Command node).Source
New-Item -ItemType Directory -Force -Path $paths.Logs | Out-Null

$apiPort = if ($envMap.ContainsKey('API_PORT')) { $envMap['API_PORT'] } else { '4000' }
$webPort = if ($envMap.ContainsKey('WEB_PORT_INTERNAL')) { $envMap['WEB_PORT_INTERNAL'] } else { '3000' }
$webHost = if ($envMap.ContainsKey('WEB_HOST_INTERNAL')) { $envMap['WEB_HOST_INTERNAL'] } else { '127.0.0.1' }

if ($Role -eq 'api') {
  foreach ($k in $envMap.Keys) { [Environment]::SetEnvironmentVariable($k, $envMap[$k], 'Process') }
  $workDir = Join-Path $paths.App 'apps\api'
  # --title: süreç komut satırına kurulum kimliği ekler; durdurma/kaldırma betikleri bu imzayla süreci bulur.
  $nodeArgs = @("--title=TronMonitor-api@$InstallDir", 'dist\main.js')
} else {
  [Environment]::SetEnvironmentVariable('NODE_ENV', 'production', 'Process')
  [Environment]::SetEnvironmentVariable('NEXT_TELEMETRY_DISABLED', '1', 'Process')
  [Environment]::SetEnvironmentVariable('API_INTERNAL_URL', "http://127.0.0.1:$apiPort", 'Process')
  $workDir = Join-Path $paths.App 'apps\web'
  # npm çalışma alanlarında next kök node_modules altına kaldırılır; yerel kopya varsa o tercih edilir.
  $nextBin = Join-Path $workDir 'node_modules\next\dist\bin\next'
  if (-not (Test-Path $nextBin)) { $nextBin = Join-Path $paths.App 'node_modules\next\dist\bin\next' }
  $nodeArgs = @("--title=TronMonitor-web@$InstallDir", $nextBin, 'start', '-H', $webHost, '-p', $webPort)
}

$restarts = 0
while ($true) {
  $stamp = Get-Date -Format 'yyyyMMdd'
  $out = Join-Path $paths.Logs "$Role-$stamp.log"
  $err = Join-Path $paths.Logs "$Role-$stamp.err.log"
  Add-Content -Path $out -Value "[$(Get-Date -Format s)] $Role başlatılıyor: node $($nodeArgs -join ' ')"
  $proc = Start-Process -FilePath $node -ArgumentList $nodeArgs -WorkingDirectory $workDir -NoNewWindow -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
  $proc.WaitForExit()
  $restarts++
  Add-Content -Path $out -Value "[$(Get-Date -Format s)] $Role çıktı (kod $($proc.ExitCode)); 5 sn sonra yeniden başlatılacak (#$restarts)"
  Start-Sleep -Seconds 5
}
