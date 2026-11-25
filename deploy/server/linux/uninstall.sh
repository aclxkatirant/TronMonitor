#!/usr/bin/env bash
# TronMonitor kaldırma: hizmetler, systemd birimleri, Nginx sitesi ve uygulama dizini silinir.
# Veritabanı, ortam dosyası ve yedekler --purge verilmedikçe KORUNUR.
#
# Kullanım (root):
#   sudo bash uninstall.sh [--purge] [--yes]
#
# --purge: veritabanı ve rolü düşürülür, /etc/tronmonitor ve yedekler dahil /var/lib/tronmonitor silinir, sistem kullanıcısı kaldırılır.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
. "$SCRIPT_DIR/common.sh"

PURGE=false
ASSUME_YES=false
while [ $# -gt 0 ]; do
  case "$1" in
    --purge) PURGE=true; shift ;;
    --yes) ASSUME_YES=true; shift ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) die "Bilinmeyen seçenek: $1" ;;
  esac
done
require_root

if [ "$ASSUME_YES" = "false" ]; then
  if [ "$PURGE" = "true" ]; then
    printf 'TronMonitor, veritabanı, ortam dosyası ve YEDEKLER dahil tamamen silinecek. Devam edilsin mi? [evet/hayır] '
  else
    printf 'TronMonitor hizmetleri ve uygulama dizini silinecek (veritabanı ve yedekler korunur). Devam edilsin mi? [evet/hayır] '
  fi
  read -r answer
  [ "$answer" = "evet" ] || die "İptal edildi."
fi

for unit in "$TM_WEB_SERVICE" "$TM_API_SERVICE"; do
  if systemctl list-unit-files | grep -q "^${unit}.service"; then
    log "Hizmet kaldırılıyor: $unit"
    systemctl disable --now "$unit" >/dev/null 2>&1 || true
    rm -f "/etc/systemd/system/${unit}.service"
  fi
done
systemctl daemon-reload

if [ -e "/etc/nginx/sites-enabled/${TM_NGINX_SITE}" ] || [ -e "/etc/nginx/sites-available/${TM_NGINX_SITE}" ]; then
  log "Nginx sitesi kaldırılıyor"
  rm -f "/etc/nginx/sites-enabled/${TM_NGINX_SITE}" "/etc/nginx/sites-available/${TM_NGINX_SITE}"
  nginx -t >/dev/null 2>&1 && systemctl reload nginx || true
fi

log "Uygulama dizini siliniyor: $TM_APP_DIR"
rm -rf "$TM_APP_DIR" "$TM_INSTALL_DIR/.npm" "$TM_INSTALL_DIR/.gocache" "$TM_INSTALL_DIR/go" "$TM_INSTALL_DIR/.cache"

if [ "$PURGE" = "true" ]; then
  if command -v psql >/dev/null 2>&1 && id postgres >/dev/null 2>&1; then
    log "Veritabanı ve rol düşürülüyor"
    runuser -u postgres -- psql -c "DROP DATABASE IF EXISTS tronmonitor;" >/dev/null || true
    runuser -u postgres -- psql -c "DROP ROLE IF EXISTS tronmonitor;" >/dev/null || true
  fi
  rm -rf "$TM_CONFIG_DIR" "$TM_DATA_DIR" /var/log/tronmonitor "$TM_INSTALL_DIR"
  if id "$TM_USER" >/dev/null 2>&1; then userdel "$TM_USER" || true; fi
  log "Tamamen kaldırıldı."
else
  log "Kaldırıldı. Korunanlar: veritabanı 'tronmonitor', $TM_ENV_FILE, $TM_BACKUP_DIR"
fi
