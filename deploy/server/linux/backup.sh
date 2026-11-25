#!/usr/bin/env bash
# TronMonitor yedekleme: PostgreSQL dökümü (pg_dump özel biçim), ortam dosyası ve ajan ikili dosyaları
# tek bir arşivde toplanır. Varsayılan hedef: /var/lib/tronmonitor/backups.
#
# Kullanım (root):
#   sudo bash backup.sh [--dir <dizin>] [--keep 14] [--label <etiket>]
#
# --keep N: en yeni N yedek dışındakiler silinir (0 = silme).
# Düzenli yedek için: sudo systemctl edit --force --full tronmonitor-backup.timer (bkz. docs/isletim.md)

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
. "$SCRIPT_DIR/common.sh"

DEST="$TM_BACKUP_DIR"
KEEP=14
LABEL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DEST="$2"; shift 2 ;;
    --keep) KEEP="$2"; shift 2 ;;
    --label) LABEL="-$2"; shift 2 ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) die "Bilinmeyen seçenek: $1" ;;
  esac
done

require_root
[ -f "$TM_ENV_FILE" ] || die "Kurulum bulunamadı ($TM_ENV_FILE yok)."
DATABASE_URL="$(env_get DATABASE_URL)"
# pg_dump/pg_restore URI sorgu parametrelerini (ör. ?schema=public) kabul etmez.
PG_URL="${DATABASE_URL%%\?*}"
command -v pg_dump >/dev/null 2>&1 || die "pg_dump bulunamadı (postgresql-client paketi)."

STAMP="$(date +%Y%m%d-%H%M%S)"
NAME="tronmonitor-${STAMP}${LABEL}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$DEST" "$WORK/$NAME"
chmod 750 "$DEST"

log "Veritabanı dökümü alınıyor"
pg_dump --dbname="$PG_URL" --format=custom --no-owner --no-privileges --file="$WORK/$NAME/database.dump"
cp "$TM_ENV_FILE" "$WORK/$NAME/api.env"
if [ -d "$TM_APP_DIR/agent/dist" ]; then
  mkdir -p "$WORK/$NAME/agent-dist"
  cp -a "$TM_APP_DIR/agent/dist/." "$WORK/$NAME/agent-dist/"
fi
cat > "$WORK/$NAME/MANIFEST" <<EOF
tronmonitor-backup=1
created=$(date --iso-8601=seconds)
host=$(hostname)
app_version=$(node -p "require('$TM_APP_DIR/package.json').version" 2>/dev/null || echo bilinmiyor)
git_commit=$(git -C "$TM_APP_DIR" rev-parse --short HEAD 2>/dev/null || echo bilinmiyor)
EOF

ARCHIVE="$DEST/$NAME.tar.gz"
tar -C "$WORK" -czf "$ARCHIVE" "$NAME"
chmod 600 "$ARCHIVE"
log "Yedek yazıldı: $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"

if [ "$KEEP" -gt 0 ]; then
  # shellcheck disable=SC2012
  ls -1t "$DEST"/tronmonitor-*.tar.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
    log "Eski yedek siliniyor: $old"
    rm -f "$old"
  done
fi
