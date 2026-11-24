<#
.SYNOPSIS
  TronMonitor Agent kaldırma betiği (Windows).
.EXAMPLE
  .\uninstall-agent.ps1 [-KeepLogs]
#>
[CmdletBinding()]
param(
  [switch]$KeepLogs,
  [string]$InstallDir = "$env:ProgramFiles\TronMonitor\Agent"
)
$ErrorActionPreference = "Continue"
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Write-Host "Bu betik yönetici PowerShell oturumunda çalıştırılmalıdır." -ForegroundColor Red; exit 1 }

$target = Join-Path $InstallDir "tronmonitor-agent.exe"
if (Test-Path $target) { & $target uninstall | Out-Null }
if (Get-Service tronmonitor-agent -ErrorAction SilentlyContinue) {
  Stop-Service tronmonitor-agent -Force -ErrorAction SilentlyContinue
  sc.exe delete tronmonitor-agent | Out-Null
}
Remove-Item -Recurse -Force $InstallDir -ErrorAction SilentlyContinue
$cfgDir = Join-Path $env:ProgramData "TronMonitor\Agent"
if ($KeepLogs) {
  Remove-Item (Join-Path $cfgDir "agent.json") -Force -ErrorAction SilentlyContinue
} else {
  Remove-Item -Recurse -Force $cfgDir -ErrorAction SilentlyContinue
}
Write-Host "[TronMonitor] Ajan kaldırıldı. Sunucu kaydını panodan da kaldırmayı unutmayın." -ForegroundColor Cyan
