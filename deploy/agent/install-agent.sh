#!/usr/bin/env bash
# TronMonitor Agent kurulum betiği (Ubuntu 22.04 / 24.04, Debian 12)
# Kullanım: sudo bash install-agent.sh --server https://tron.kurum.com --token tmr_XXXX [--service-user tronmonitor] [--ca-file /yol/ca.pem] [--allow-http]
set -euo pipefail

SERVER=""
TOKEN=""
SERVICE_USER=""
CA_FILE=""
ALLOW_HTTP=0
INSTALL_DIR="/opt/tronmonitor"
BIN_LINK="/usr/local/bin/tronmonitor-agent"

log()  { printf '\033[1;36m[TronMonitor]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[TronMonitor] Hata:\033[0m %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --server) SERVER="$2"; shift 2 ;;
    --token) TOKEN="$2"; shift 2 ;;
    --service-user) SERVICE_USER="$2"; shift 2 ;;
    --ca-file) CA_FILE="$2"; shift 2 ;;
    --allow-http) ALLOW_HTTP=1; shift ;;
    -h|--help)
      sed -n '2,4p' "$0"; exit 0 ;;
    *) fail "Bilinmeyen seçenek: $1" ;;
  esac
done

[ -n "$SERVER" ] || fail "--server zorunludur"
[ -n "$TOKEN" ] || fail "--token zorunludur"
[ "$(id -u)" -eq 0 ] || fail "Bu betik root yetkisiyle çalıştırılmalıdır (sudo)."
command -v systemctl >/dev/null 2>&1 || fail "systemd bulunamadı; desteklenen dağıtımlar Ubuntu 22.04/24.04 ve Debian 12'dir."
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum bulunamadı."

SERVER="${SERVER%/}"
case "$SERVER" in
  https://*) ;;
  http://*) [ "$ALLOW_HTTP" -eq 1 ] || fail "Sunucu adresi HTTPS olmalıdır. Yalnızca test ortamında --allow-http kullanın." ;;
  *) fail "Sunucu adresi http:// veya https:// ile başlamalıdır." ;;
esac

case "$(uname -m)" in
  x86_64|amd64) ARCH="amd64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) fail "Desteklenmeyen mimari: $(uname -m)" ;;
esac
BINARY="tronmonitor-agent-linux-${ARCH}"

if command -v curl >/dev/null 2>&1; then
  fetch() { curl -fsSL --retry 3 --connect-timeout 15 "$1" -o "$2"; }
elif command -v wget >/dev/null 2>&1; then
  fetch() { wget -q --tries=3 --timeout=15 -O "$2" "$1"; }
else
  fail "curl veya wget gerekli."
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

log "İşletim sistemi: $(. /etc/os-release 2>/dev/null && echo "${PRETTY_NAME:-Linux}") · mimari: ${ARCH}"
log "Ajan indiriliyor: ${SERVER}/api/v1/agent-downloads/${BINARY}"
fetch "${SERVER}/api/v1/agent-downloads/${BINARY}" "${TMP}/${BINARY}"
fetch "${SERVER}/api/v1/agent-downloads/SHA256SUMS" "${TMP}/SHA256SUMS"
sed -i 's/\r$//' "${TMP}/SHA256SUMS"   # Windows'ta üretilmiş CRLF dosyalara tolerans

log "Bütünlük doğrulanıyor (SHA-256)"
EXPECTED="$(grep -E "[[:space:]]\*?${BINARY}\$" "${TMP}/SHA256SUMS" | awk '{print $1}' | head -n1)"
[ -n "$EXPECTED" ] || fail "SHA256SUMS dosyasında ${BINARY} için özet bulunamadı."
ACTUAL="$(sha256sum "${TMP}/${BINARY}" | awk '{print $1}')"
[ "$EXPECTED" = "$ACTUAL" ] || fail "Özet uyuşmuyor! Beklenen ${EXPECTED}, bulunan ${ACTUAL}. İndirilen dosya çalıştırılmadı."

if [ -x "${BIN_LINK}" ] && "${BIN_LINK}" service status >/dev/null 2>&1; then
  log "Mevcut hizmet durduruluyor"
  "${BIN_LINK}" service stop >/dev/null 2>&1 || true
fi

mkdir -p "${INSTALL_DIR}"
install -m 0755 "${TMP}/${BINARY}" "${INSTALL_DIR}/tronmonitor-agent"
cp "${TMP}/SHA256SUMS" "${INSTALL_DIR}/SHA256SUMS"
ln -sf "${INSTALL_DIR}/tronmonitor-agent" "${BIN_LINK}"
log "Ajan ${INSTALL_DIR}/tronmonitor-agent konumuna kuruldu ($("${BIN_LINK}" version))"

if [ -n "$SERVICE_USER" ]; then
  if ! id "$SERVICE_USER" >/dev/null 2>&1; then
    log "Sistem hesabı oluşturuluyor: ${SERVICE_USER}"
    useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
  fi
  mkdir -p /etc/tronmonitor /var/log/tronmonitor
  chown "$SERVICE_USER":"$SERVICE_USER" /etc/tronmonitor /var/log/tronmonitor
fi

ARGS=(install --server "$SERVER" --token "$TOKEN" --force)
[ "$ALLOW_HTTP" -eq 1 ] && ARGS+=(--allow-http)
[ -n "$CA_FILE" ] && ARGS+=(--ca-file "$CA_FILE")
[ -n "$SERVICE_USER" ] && ARGS+=(--service-user "$SERVICE_USER")

log "Sunucu kaydediliyor ve hizmet kuruluyor"
"${BIN_LINK}" "${ARGS[@]}"

log "Kurulum tamamlandı. Durum:"
"${BIN_LINK}" status || true
systemctl --no-pager --lines=0 status tronmonitor-agent || true
