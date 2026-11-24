# TronMonitor Agent - tüm hedefler için yerel ikili dosyaları derler ve SHA256 özetlerini yazar.
# Kullanım: .\build.ps1 [-Version 0.1.0]
param(
  [string]$Version = "0.1.0",
  [string]$OutDir = "dist"
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$commit = (git rev-parse --short HEAD 2>$null)
if (-not $commit) { $commit = "unknown" }
$date = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$ldflags = "-s -w -X github.com/aclxkatirant/TronMonitor/agent/internal/buildinfo.Version=$Version " +
           "-X github.com/aclxkatirant/TronMonitor/agent/internal/buildinfo.Commit=$commit " +
           "-X github.com/aclxkatirant/TronMonitor/agent/internal/buildinfo.BuildDate=$date"

$targets = @(
  @{ os = "windows"; arch = "amd64"; name = "tronmonitor-agent-windows-amd64.exe" },
  @{ os = "windows"; arch = "arm64"; name = "tronmonitor-agent-windows-arm64.exe" },
  @{ os = "linux";   arch = "amd64"; name = "tronmonitor-agent-linux-amd64" },
  @{ os = "linux";   arch = "arm64"; name = "tronmonitor-agent-linux-arm64" }
)

New-Item -ItemType Directory -Force $OutDir | Out-Null
Remove-Item "$OutDir\SHA256SUMS" -ErrorAction SilentlyContinue

foreach ($t in $targets) {
  $env:GOOS = $t.os; $env:GOARCH = $t.arch; $env:CGO_ENABLED = "0"
  $out = Join-Path $OutDir $t.name
  Write-Host "Derleniyor: $($t.os)/$($t.arch) -> $out"
  go build -trimpath -ldflags $ldflags -o $out ./cmd/tronmonitor-agent
  if ($LASTEXITCODE -ne 0) { throw "Derleme başarısız: $($t.os)/$($t.arch)" }
  $hash = (Get-FileHash $out -Algorithm SHA256).Hash.ToLower()
  Add-Content -Path "$OutDir\SHA256SUMS" -Value "$hash  $($t.name)" -Encoding ascii
}
Remove-Item Env:GOOS, Env:GOARCH, Env:CGO_ENABLED -ErrorAction SilentlyContinue
Write-Host "Tamamlandı. Özetler: $OutDir\SHA256SUMS"
Get-Content "$OutDir\SHA256SUMS"
