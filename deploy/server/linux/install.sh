#!/usr/bin/env bash
# TronMonitor merkezi sunucu kurulumu (Ubuntu 22.04 / 24.04, Debian 12).
#
# Kullanım (root):
#   sudo bash deploy/server/linux/install.sh --domain tron.kurum.com [seçenekler]
#
# Seçenekler:
#   --domain <ad>          Panonun alan adı (Nginx server_name ve WEB_ORIGIN). Zorunlu (--no-nginx ile IP de olabilir).
#   --source <dizin|git>   Kaynak: depo dizini (varsayılan: bu betiğin bulunduğu depo) veya git adresi.
#   --branch <dal>         Git kaynağı için dal (varsayılan: main).
#   --tls-cert <yol> --tls-key <yol>
#                          Mevcut sertifika/anahtar. Verilmezse kendinden imzalı sertifika üretilir
#                          (tarayıcı uyarır; certbot ile değiştirin — bkz. docs/kurulum.md).
#   --no-nginx             Nginx kurulmaz/yapılandırılmaz (kendi ters vekilinizi kullanın).
#   --database-url <url>   Harici PostgreSQL kullan (yerel PostgreSQL kurulmaz, veritabanı oluşturulmaz).
#   --redis-url <url>      Harici Redis kullan (yerel Redis kurulmaz).
#   --skip-system-deps     apt ile paket kurma (Node.js, PostgreSQL, Redis, Nginx zaten kuruluysa).
#   --skip-agent-build     Go kuruluysa bile ajan ikili dosyalarını derleme.
#   --http                 HTTPS yerine düz HTTP (yalnızca kapalı iç ağ; çerezler güvenli bayraksız gönderilir).
#   --force                Doğrulanmamış dağıtımda devam et.
#
# Betik yeniden çalıştırılabilir: mevcut api.env ve veritabanı korunur, kod ve derleme yenilenir.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
. "$SCRIPT_DIR/common.sh"

DOMAIN=""
SOURCE="$(cd "$SCRIPT_DIR/../../.." && pwd)"
BRANCH="main"
TLS_CERT=""
TLS_KEY=""
WITH_NGINX=true
DATABASE_URL=""
REDIS_URL=""
SKIP_SYSTEM_DEPS=false
SKIP_AGENT_BUILD=false
USE_HTTP=false
FORCE=false

while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --source) SOURCE="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --tls-cert) TLS_CERT="$2"; shift 2 ;;
    --tls-key) TLS_KEY="$2"; shift 2 ;;
    --no-nginx) WITH_NGINX=false; shift ;;
    --database-url) DATABASE_URL="$2"; shift 2 ;;
    --redis-url) REDIS_URL="$2"; shift 2 ;;
    --skip-system-deps) SKIP_SYSTEM_DEPS=true; shift ;;
    --skip-agent-build) SKIP_AGENT_BUILD=true; shift ;;
    --http) USE_HTTP=true; shift ;;
    --force) FORCE=true; shift ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    *) die "Bilinmeyen seçenek: $1 (yardım için --help)" ;;
  esac
done

require_root
check_os "$FORCE"
[ -n "$DOMAIN" ] || die "--domain zorunludur (ör. --domain tron.kurum.com)."
if [ -n "$TLS_CERT" ] && [ -z "$TLS_KEY" ] || [ -z "$TLS_CERT" ] && [ -n "$TLS_KEY" ]; then
  die "--tls-cert ve --tls-key birlikte verilmelidir."
fi

SCHEME="https"; [ "$USE_HTTP" = "true" ] && SCHEME="http"
WEB_ORIGIN="${SCHEME}://${DOMAIN}"
export DEBIAN_FRONTEND=noninteractive

# ---------------------------------------------------------------------------
# 1) Sistem paketleri
# ---------------------------------------------------------------------------
if [ "$SKIP_SYSTEM_DEPS" = "false" ]; then
  log "Sistem paketleri kuruluyor"
  apt-get update -qq
  apt-get install -y -qq curl ca-certificates gnupg git rsync openssl acl
  [ -z "$DATABASE_URL" ] && apt-get install -y -qq postgresql
  [ -z "$REDIS_URL" ] && apt-get install -y -qq redis-server
  [ "$WITH_NGINX" = "true" ] && apt-get install -y -qq nginx
  if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/^v//' | cut -d. -f1)" -lt "$TM_NODE_MAJOR" ]; then
    # NodeSource deposu: https://github.com/nodesource/distributions (dağıtım depolarındaki Node.js çok eski).
    log "Node.js ${TM_NODE_MAJOR} NodeSource deposundan kuruluyor"
    mkdir -p /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg --yes
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${TM_NODE_MAJOR}.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
    apt-get update -qq
    apt-get install -y -qq nodejs
  fi
fi
command -v node >/dev/null 2>&1 || die "node bulunamadı."
NODE_MAJOR_FOUND="$(node -v | sed 's/^v//' | cut -d. -f1)"
[ "$NODE_MAJOR_FOUND" -ge "$TM_NODE_MAJOR" ] || die "Node.js ${TM_NODE_MAJOR}+ gerekli (bulunan: $(node -v))."
command -v psql >/dev/null 2>&1 || [ -n "$DATABASE_URL" ] || die "psql bulunamadı."

# ---------------------------------------------------------------------------
# 2) Kullanıcı ve dizinler
# ---------------------------------------------------------------------------
if ! id "$TM_USER" >/dev/null 2>&1; then
  log "Sistem kullanıcısı oluşturuluyor: $TM_USER"
  useradd --system --home-dir "$TM_INSTALL_DIR" --shell /usr/sbin/nologin "$TM_USER"
fi
mkdir -p "$TM_INSTALL_DIR" "$TM_APP_DIR" "$TM_CONFIG_DIR" "$TM_DATA_DIR" "$TM_BACKUP_DIR" /var/log/tronmonitor
chown "$TM_USER:$TM_USER" "$TM_INSTALL_DIR" "$TM_DATA_DIR" "$TM_BACKUP_DIR" /var/log/tronmonitor
chmod 750 "$TM_CONFIG_DIR" "$TM_DATA_DIR" "$TM_BACKUP_DIR"
chgrp "$TM_USER" "$TM_CONFIG_DIR"

# ---------------------------------------------------------------------------
# 3) Kaynak kod
# ---------------------------------------------------------------------------
if [ -d "$SOURCE" ]; then
  log "Kaynak kopyalanıyor: $SOURCE -> $TM_APP_DIR"
  rsync -a --delete --exclude node_modules --exclude .git --exclude 'apps/*/dist' --exclude 'apps/web/.next' \
    --exclude 'apps/api/src/generated' --exclude '.env' --exclude '.env.*' --include '.env.example' "$SOURCE/" "$TM_APP_DIR/"
else
  if [ -d "$TM_APP_DIR/.git" ]; then
    log "Git deposu güncelleniyor ($BRANCH)"
    git -C "$TM_APP_DIR" fetch --quiet origin "$BRANCH" && git -C "$TM_APP_DIR" checkout --quiet "$BRANCH" && git -C "$TM_APP_DIR" reset --quiet --hard "origin/$BRANCH"
  else
    log "Git deposu klonlanıyor: $SOURCE ($BRANCH)"
    rm -rf "$TM_APP_DIR"
    git clone --quiet --branch "$BRANCH" "$SOURCE" "$TM_APP_DIR"
  fi
fi
chown -R "$TM_USER:$TM_USER" "$TM_APP_DIR"

# ---------------------------------------------------------------------------
# 4) Veritabanı
# ---------------------------------------------------------------------------
if [ -z "$DATABASE_URL" ]; then
  systemctl enable --now postgresql >/dev/null
  DB_PASSWORD="$(env_get DB_PASSWORD_INTERNAL || true)"
  if [ -z "$DB_PASSWORD" ]; then DB_PASSWORD="$(random_hex 24)"; fi
  if ! runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='tronmonitor'" | grep -q 1; then
    log "PostgreSQL rolü oluşturuluyor"
    runuser -u postgres -- psql -v ON_ERROR_STOP=1 -c "CREATE ROLE tronmonitor LOGIN PASSWORD '${DB_PASSWORD}';"
  else
    runuser -u postgres -- psql -v ON_ERROR_STOP=1 -c "ALTER ROLE tronmonitor PASSWORD '${DB_PASSWORD}';"
  fi
  if ! runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_database WHERE datname='tronmonitor'" | grep -q 1; then
    log "Veritabanı oluşturuluyor"
    runuser -u postgres -- createdb -O tronmonitor -E UTF8 tronmonitor
  fi
  DATABASE_URL="postgresql://tronmonitor:${DB_PASSWORD}@127.0.0.1:5432/tronmonitor"
fi
if [ -z "$REDIS_URL" ]; then
  systemctl enable --now redis-server >/dev/null
  REDIS_URL="redis://127.0.0.1:6379"
fi

# ---------------------------------------------------------------------------
# 5) Ortam dosyası (mevcutsa sırlar korunur)
# ---------------------------------------------------------------------------
if [ ! -f "$TM_ENV_FILE" ]; then
  log "Ortam dosyası yazılıyor: $TM_ENV_FILE"
  SESSION_SECRET="$(random_base64 48)"
  ENCRYPTION_KEY="$(random_base64 32)"
  COOKIE_SECURE_LINE=""
  [ "$USE_HTTP" = "true" ] && COOKIE_SECURE_LINE="COOKIE_SECURE=false"
  umask 027
  cat > "$TM_ENV_FILE" <<EOF
# TronMonitor API üretim ortamı — bu dosya sır içerir (yalnızca root ve ${TM_USER} okuyabilir).
NODE_ENV=production
API_HOST=127.0.0.1
API_PORT=4000
WEB_ORIGIN=${WEB_ORIGIN}
DATABASE_URL=${DATABASE_URL}
REDIS_URL=${REDIS_URL}
SESSION_SECRET=${SESSION_SECRET}
ENCRYPTION_KEY=${ENCRYPTION_KEY}
SESSION_TTL_HOURS=24
LOG_LEVEL=info
${COOKIE_SECURE_LINE}
AGENT_RELEASES_DIR=${TM_APP_DIR}/agent/dist
AGENT_SCRIPTS_DIR=${TM_APP_DIR}/deploy/agent
EOF
  if [ -n "${DB_PASSWORD:-}" ]; then echo "DB_PASSWORD_INTERNAL=${DB_PASSWORD}" >> "$TM_ENV_FILE"; fi
  chown root:"$TM_USER" "$TM_ENV_FILE"
  chmod 640 "$TM_ENV_FILE"
else
  log "Mevcut ortam dosyası korunuyor: $TM_ENV_FILE"
  # Alan adı değiştiyse WEB_ORIGIN güncellenir.
  sed -i "s#^WEB_ORIGIN=.*#WEB_ORIGIN=${WEB_ORIGIN}#" "$TM_ENV_FILE"
fi
API_PORT="$(env_get API_PORT || echo 4000)"

# ---------------------------------------------------------------------------
# 6) Bağımlılıklar, derleme, veritabanı şeması
# ---------------------------------------------------------------------------
log "npm bağımlılıkları kuruluyor (birkaç dakika sürebilir)"
run_as_app "$TM_APP_DIR" "DATABASE_URL='${DATABASE_URL}' npm ci --no-audit --no-fund --loglevel=error"
log "API ve web derleniyor"
run_as_app "$TM_APP_DIR" "NODE_ENV=production DATABASE_URL='${DATABASE_URL}' npm run build --workspace apps/api --workspace apps/web --loglevel=error"
log "Veritabanı şeması uygulanıyor"
run_as_app "$TM_APP_DIR/apps/api" "DATABASE_URL='${DATABASE_URL}' npx prisma migrate deploy"

if [ "$SKIP_AGENT_BUILD" = "false" ]; then
  if command -v go >/dev/null 2>&1; then
    log "Ajan ikili dosyaları derleniyor (Go $(go version | awk '{print $3}'))"
    APP_VERSION="$(node -p "require('$TM_APP_DIR/package.json').version")"
    run_as_app "$TM_APP_DIR/agent" "GOFLAGS=-mod=mod GOCACHE=$TM_INSTALL_DIR/.gocache GOPATH=$TM_INSTALL_DIR/go bash ./build.sh '$APP_VERSION'"
  elif [ ! -f "$TM_APP_DIR/agent/dist/SHA256SUMS" ]; then
    warn "Go bulunamadı ve agent/dist boş: ajan indirme uçları çalışmaz. Ajanı başka bir makinede derleyip (agent/build.sh) dist/ içeriğini ${TM_APP_DIR}/agent/dist/ dizinine kopyalayın."
  fi
fi

# ---------------------------------------------------------------------------
# 7) systemd birimleri
# ---------------------------------------------------------------------------
log "systemd birimleri kuruluyor"
for unit in "$TM_API_SERVICE" "$TM_WEB_SERVICE"; do
  sed -e "s#/opt/tronmonitor#${TM_INSTALL_DIR}#g" -e "s#/etc/tronmonitor#${TM_CONFIG_DIR}#g" -e "s#/var/lib/tronmonitor#${TM_DATA_DIR}#g" \
      -e "s#User=tronmonitor#User=${TM_USER}#" -e "s#Group=tronmonitor#Group=${TM_USER}#" \
      "$TM_APP_DIR/deploy/server/linux/${unit}.service" > "/etc/systemd/system/${unit}.service"
done
sed -i "s#-p 3000#-p 3000#; s#127.0.0.1:4000#127.0.0.1:${API_PORT}#" "/etc/systemd/system/${TM_WEB_SERVICE}.service"
systemctl daemon-reload
systemctl enable --now "$TM_API_SERVICE" >/dev/null
systemctl restart "$TM_API_SERVICE"
systemctl enable --now "$TM_WEB_SERVICE" >/dev/null
systemctl restart "$TM_WEB_SERVICE"

# ---------------------------------------------------------------------------
# 8) Nginx
# ---------------------------------------------------------------------------
if [ "$WITH_NGINX" = "true" ]; then
  if [ "$USE_HTTP" = "true" ]; then
    log "Nginx (düz HTTP) yapılandırılıyor"
    cat > "/etc/nginx/sites-available/${TM_NGINX_SITE}" <<EOF
map \$http_upgrade \$connection_upgrade { default upgrade; '' close; }
server {
    listen 80;
    server_name ${DOMAIN};
    client_max_body_size 10m;
    location /api/ {
        proxy_pass http://127.0.0.1:${API_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 3600s;
        proxy_buffering off;
    }
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
  else
    if [ -z "$TLS_CERT" ]; then
      TLS_CERT="$TM_CONFIG_DIR/tls/fullchain.pem"
      TLS_KEY="$TM_CONFIG_DIR/tls/privkey.pem"
      if [ ! -f "$TLS_CERT" ]; then
        log "Kendinden imzalı sertifika üretiliyor (tarayıcı uyarır; certbot ile değiştirin)"
        mkdir -p "$TM_CONFIG_DIR/tls"
        openssl req -x509 -nodes -newkey rsa:2048 -days 825 -subj "/CN=${DOMAIN}" -addext "subjectAltName=DNS:${DOMAIN}" \
          -keyout "$TLS_KEY" -out "$TLS_CERT" >/dev/null 2>&1
        chmod 600 "$TLS_KEY"
      fi
    fi
    log "Nginx (HTTPS) yapılandırılıyor"
    sed -e "s#__DOMAIN__#${DOMAIN}#g" -e "s#__TLS_CERT__#${TLS_CERT}#g" -e "s#__TLS_KEY__#${TLS_KEY}#g" -e "s#127.0.0.1:4000#127.0.0.1:${API_PORT}#g" \
      "$TM_APP_DIR/deploy/server/nginx/tronmonitor.conf" > "/etc/nginx/sites-available/${TM_NGINX_SITE}"
  fi
  ln -sf "/etc/nginx/sites-available/${TM_NGINX_SITE}" "/etc/nginx/sites-enabled/${TM_NGINX_SITE}"
  rm -f /etc/nginx/sites-enabled/default
  nginx -t
  systemctl enable --now nginx >/dev/null
  systemctl reload nginx
fi

# ---------------------------------------------------------------------------
# 9) Sağlık denetimi
# ---------------------------------------------------------------------------
log "API sağlık denetimi bekleniyor"
if wait_for_health "$API_PORT" 30; then
  log "API sağlıklı: $(api_health "$API_PORT")"
else
  warn "API sağlık ucu yanıt vermedi. Günlük: journalctl -u ${TM_API_SERVICE} -n 100"
  exit 1
fi

cat <<EOF

TronMonitor kuruldu.
  Pano:            ${WEB_ORIGIN}
  İlk kurulum:     ${WEB_ORIGIN}/kurulum  (ilk hesap süper yönetici olur)
  Uygulama dizini: ${TM_APP_DIR}
  Ortam dosyası:   ${TM_ENV_FILE}  (sırlar; yedekleyin)
  Günlükler:       journalctl -u ${TM_API_SERVICE} -f   |   journalctl -u ${TM_WEB_SERVICE} -f
  Güncelleme:      sudo bash ${TM_APP_DIR}/deploy/server/linux/update.sh
  Yedekleme:       sudo bash ${TM_APP_DIR}/deploy/server/linux/backup.sh
EOF
if [ "$WITH_NGINX" = "true" ] && [ "$USE_HTTP" = "false" ] && [ "$TLS_CERT" = "$TM_CONFIG_DIR/tls/fullchain.pem" ]; then
  echo "  Sertifika:       kendinden imzalı. Let's Encrypt için: apt install certbot python3-certbot-nginx && certbot --nginx -d ${DOMAIN}"
fi
