#!/usr/bin/env bash
# TronMonitor güncelleme: önce yedek alır, kaynağı yeniler, bağımlılıkları kurar, derler,
# veritabanı göçlerini uygular ve hizmetleri yeniden başlatır.
#
# Kullanım (root):
#   sudo bash /opt/tronmonitor/app/deploy/server/linux/update.sh [--source <dizin|git>] [--branch main] [--no-backup] [--skip-agent-build]
#
# --source verilmezse: uygulama dizini bir git klonuysa `git pull`, değilse betiğin bulunduğu depo kaynak kabul edilir.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
. "$SCRIPT_DIR/common.sh"

SOURCE=""
BRANCH="main"
DO_BACKUP=true
SKIP_AGENT_BUILD=false
while [ $# -gt 0 ]; do
  case "$1" in
    --source) SOURCE="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --no-backup) DO_BACKUP=false; shift ;;
    --skip-agent-build) SKIP_AGENT_BUILD=true; shift ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) die "Bilinmeyen seçenek: $1" ;;
  esac
done

require_root
[ -f "$TM_ENV_FILE" ] || die "Kurulum bulunamadı ($TM_ENV_FILE yok). Önce install.sh çalıştırın."
DATABASE_URL="$(env_get DATABASE_URL)"
API_PORT="$(env_get API_PORT || echo 4000)"

if [ "$DO_BACKUP" = "true" ]; then
  log "Güncelleme öncesi yedek alınıyor"
  bash "$SCRIPT_DIR/backup.sh" --label pre-update
fi

if [ -n "$SOURCE" ] && [ -d "$SOURCE" ]; then
  log "Kaynak kopyalanıyor: $SOURCE"
  rsync -a --delete --exclude node_modules --exclude .git --exclude 'apps/*/dist' --exclude 'apps/web/.next' \
    --exclude 'apps/api/src/generated' --exclude '.env' --exclude '.env.*' --exclude 'agent/dist' "$SOURCE/" "$TM_APP_DIR/"
elif [ -d "$TM_APP_DIR/.git" ]; then
  log "Git deposu güncelleniyor ($BRANCH)"
  git -C "$TM_APP_DIR" fetch --quiet origin "$BRANCH"
  git -C "$TM_APP_DIR" checkout --quiet "$BRANCH"
  git -C "$TM_APP_DIR" reset --quiet --hard "origin/$BRANCH"
elif [ -n "$SOURCE" ]; then
  die "Kaynak dizin bulunamadı: $SOURCE"
else
  REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
  if [ "$REPO_ROOT" = "$TM_APP_DIR" ]; then
    die "Uygulama dizini git klonu değil; --source ile yeni sürümün dizinini verin."
  fi
  log "Kaynak kopyalanıyor: $REPO_ROOT"
  rsync -a --delete --exclude node_modules --exclude .git --exclude 'apps/*/dist' --exclude 'apps/web/.next' \
    --exclude 'apps/api/src/generated' --exclude '.env' --exclude '.env.*' --exclude 'agent/dist' "$REPO_ROOT/" "$TM_APP_DIR/"
fi
chown -R "$TM_USER:$TM_USER" "$TM_APP_DIR"

log "npm bağımlılıkları kuruluyor"
run_as_app "$TM_APP_DIR" "DATABASE_URL='${DATABASE_URL}' npm ci --no-audit --no-fund --loglevel=error"
log "API ve web derleniyor"
run_as_app "$TM_APP_DIR" "NODE_ENV=production DATABASE_URL='${DATABASE_URL}' npm run build --workspace apps/api --workspace apps/web --loglevel=error"

if [ "$SKIP_AGENT_BUILD" = "false" ] && command -v go >/dev/null 2>&1; then
  log "Ajan ikili dosyaları derleniyor"
  APP_VERSION="$(node -p "require('$TM_APP_DIR/package.json').version")"
  run_as_app "$TM_APP_DIR/agent" "GOFLAGS=-mod=mod GOCACHE=$TM_INSTALL_DIR/.gocache GOPATH=$TM_INSTALL_DIR/go bash ./build.sh '$APP_VERSION'"
fi

log "Hizmetler durduruluyor ve veritabanı göçleri uygulanıyor"
systemctl stop "$TM_WEB_SERVICE" "$TM_API_SERVICE"
run_as_app "$TM_APP_DIR/apps/api" "DATABASE_URL='${DATABASE_URL}' npx prisma migrate deploy"

log "systemd birimleri yenileniyor"
for unit in "$TM_API_SERVICE" "$TM_WEB_SERVICE"; do
  sed -e "s#/opt/tronmonitor#${TM_INSTALL_DIR}#g" -e "s#/etc/tronmonitor#${TM_CONFIG_DIR}#g" -e "s#/var/lib/tronmonitor#${TM_DATA_DIR}#g" \
      -e "s#User=tronmonitor#User=${TM_USER}#" -e "s#Group=tronmonitor#Group=${TM_USER}#" \
      "$TM_APP_DIR/deploy/server/linux/${unit}.service" > "/etc/systemd/system/${unit}.service"
done
sed -i "s#127.0.0.1:4000#127.0.0.1:${API_PORT}#" "/etc/systemd/system/${TM_WEB_SERVICE}.service"
systemctl daemon-reload
systemctl start "$TM_API_SERVICE" "$TM_WEB_SERVICE"

if wait_for_health "$API_PORT" 30; then
  log "Güncelleme tamamlandı: $(api_health "$API_PORT")"
else
  warn "API sağlık ucu yanıt vermedi. Günlük: journalctl -u ${TM_API_SERVICE} -n 100. Gerekirse restore.sh ile yedeğe dönün."
  exit 1
fi
