#!/usr/bin/env bash
# TronMonitor merkezi sunucu betiklerinin ortak parçası. Doğrudan çalıştırılmaz; diğer betikler kaynak olarak yükler.
# Desteklenen hedef: Ubuntu 22.04 / 24.04, Debian 12 (systemd). Diğer dağıtımlarda --force ile denenebilir.

set -euo pipefail

TM_INSTALL_DIR="${TM_INSTALL_DIR:-/opt/tronmonitor}"
TM_APP_DIR="$TM_INSTALL_DIR/app"
TM_CONFIG_DIR="${TM_CONFIG_DIR:-/etc/tronmonitor}"
TM_ENV_FILE="$TM_CONFIG_DIR/api.env"
TM_DATA_DIR="${TM_DATA_DIR:-/var/lib/tronmonitor}"
TM_BACKUP_DIR="$TM_DATA_DIR/backups"
TM_USER="${TM_USER:-tronmonitor}"
TM_API_SERVICE="tronmonitor-api"
TM_WEB_SERVICE="tronmonitor-web"
TM_NGINX_SITE="tronmonitor"
TM_NODE_MAJOR="${TM_NODE_MAJOR:-22}"

log()  { printf '\033[1;34m[tronmonitor]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[tronmonitor] UYARI:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[tronmonitor] HATA:\033[0m %s\n' "$*" >&2; exit 1; }

require_root() {
  [ "$(id -u)" -eq 0 ] || die "Bu betik root olarak çalıştırılmalıdır (sudo)."
}

check_os() {
  local force="${1:-false}"
  [ -r /etc/os-release ] || die "/etc/os-release okunamadı; desteklenmeyen sistem."
  # shellcheck disable=SC1091
  . /etc/os-release
  case "${ID:-}:${VERSION_ID:-}" in
    ubuntu:22.04|ubuntu:24.04|debian:12) ;;
    *)
      if [ "$force" = "true" ]; then
        warn "Doğrulanmamış dağıtım: ${PRETTY_NAME:-?}. --force ile devam ediliyor."
      else
        die "Desteklenen dağıtımlar: Ubuntu 22.04 / 24.04, Debian 12 (bulunan: ${PRETTY_NAME:-?}). Yine de denemek için --force verin."
      fi
      ;;
  esac
  command -v systemctl >/dev/null 2>&1 || die "systemd gerekli."
}

# api.env dosyasından bir değişkeni okur (tırnak ve boşluklar temizlenir).
env_get() {
  local key="$1"
  [ -r "$TM_ENV_FILE" ] || return 1
  sed -n "s/^${key}=//p" "$TM_ENV_FILE" | head -n1 | sed -e 's/^"//' -e 's/"$//'
}

random_base64() { openssl rand -base64 "$1" | tr -d '\n'; }
random_hex() { openssl rand -hex "$1" | tr -d '\n'; }

# Uygulama dizininde tronmonitor kullanıcısıyla komut çalıştırır.
run_as_app() {
  local dir="$1"; shift
  runuser -u "$TM_USER" -- env HOME="$TM_INSTALL_DIR" PATH="/usr/local/bin:/usr/bin:/bin" bash -c "cd '$dir' && $*"
}

api_health() {
  local port="${1:-4000}"
  curl -fsS --max-time 5 "http://127.0.0.1:${port}/api/v1/health" 2>/dev/null
}

wait_for_health() {
  local port="$1" tries="${2:-30}"
  for _ in $(seq 1 "$tries"); do
    if api_health "$port" >/dev/null; then return 0; fi
    sleep 2
  done
  return 1
}
