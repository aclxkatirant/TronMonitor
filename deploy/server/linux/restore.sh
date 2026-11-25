#!/usr/bin/env bash
# TronMonitor geri yükleme: backup.sh ile alınan arşivden veritabanını (ve isteğe bağlı ortam dosyasını)
# geri yükler. Mevcut veritabanı içeriği SİLİNİR ve yedektekiyle değiştirilir.
#
# Kullanım (root):
#   sudo bash restore.sh <arşiv.tar.gz> [--with-env] [--yes]
#
# --with-env: arşivdeki api.env de geri yüklenir (sırlar dahil; taşıma senaryosu için).
# --yes:      onay sorusu sorulmaz.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
. "$SCRIPT_DIR/common.sh"

ARCHIVE=""
WITH_ENV=false
ASSUME_YES=false
while [ $# -gt 0 ]; do
  case "$1" in
    --with-env) WITH_ENV=true; shift ;;
    --yes) ASSUME_YES=true; shift ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) ARCHIVE="$1"; shift ;;
  esac
done

require_root
[ -n "$ARCHIVE" ] && [ -f "$ARCHIVE" ] || die "Arşiv dosyası verin: restore.sh /var/lib/tronmonitor/backups/tronmonitor-....tar.gz"
command -v pg_restore >/dev/null 2>&1 || die "pg_restore bulunamadı."

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
tar -C "$WORK" -xzf "$ARCHIVE"
NAME="$(ls -1 "$WORK" | head -n1)"
[ -f "$WORK/$NAME/database.dump" ] || die "Arşiv geçersiz: database.dump yok."
log "Yedek bilgisi:"; sed 's/^/  /' "$WORK/$NAME/MANIFEST" 2>/dev/null || true

if [ "$WITH_ENV" = "true" ]; then
  [ -f "$WORK/$NAME/api.env" ] || die "Arşivde api.env yok."
  mkdir -p "$TM_CONFIG_DIR"
  cp "$WORK/$NAME/api.env" "$TM_ENV_FILE"
  chown root:"$TM_USER" "$TM_ENV_FILE"; chmod 640 "$TM_ENV_FILE"
  log "Ortam dosyası geri yüklendi: $TM_ENV_FILE"
fi
[ -f "$TM_ENV_FILE" ] || die "Ortam dosyası yok; --with-env kullanın veya önce install.sh çalıştırın."
DATABASE_URL="$(env_get DATABASE_URL)"
# pg_dump/pg_restore URI sorgu parametrelerini (ör. ?schema=public) kabul etmez.
PG_URL="${DATABASE_URL%%\?*}"
API_PORT="$(env_get API_PORT || echo 4000)"

if [ "$ASSUME_YES" = "false" ]; then
  printf 'Mevcut veritabanı içeriği silinip yedektekiyle değiştirilecek. Devam edilsin mi? [evet/hayır] '
  read -r answer
  [ "$answer" = "evet" ] || die "İptal edildi."
fi

log "Hizmetler durduruluyor"
systemctl stop "$TM_WEB_SERVICE" "$TM_API_SERVICE" || true
log "Veritabanı geri yükleniyor"
pg_restore --dbname="$PG_URL" --clean --if-exists --no-owner --no-privileges --exit-on-error "$WORK/$NAME/database.dump"
log "Eksik göçler uygulanıyor (yedek eski sürümdense)"
run_as_app "$TM_APP_DIR/apps/api" "DATABASE_URL='${DATABASE_URL}' npx prisma migrate deploy"

if [ -d "$WORK/$NAME/agent-dist" ] && [ ! -f "$TM_APP_DIR/agent/dist/SHA256SUMS" ]; then
  log "Ajan ikili dosyaları geri yükleniyor"
  mkdir -p "$TM_APP_DIR/agent/dist"
  cp -a "$WORK/$NAME/agent-dist/." "$TM_APP_DIR/agent/dist/"
  chown -R "$TM_USER:$TM_USER" "$TM_APP_DIR/agent/dist"
fi

systemctl start "$TM_API_SERVICE" "$TM_WEB_SERVICE"
if wait_for_health "$API_PORT" 30; then
  log "Geri yükleme tamamlandı: $(api_health "$API_PORT")"
else
  die "API sağlık ucu yanıt vermedi. Günlük: journalctl -u ${TM_API_SERVICE} -n 100"
fi
