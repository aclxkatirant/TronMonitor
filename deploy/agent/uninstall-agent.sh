#!/usr/bin/env bash
# TronMonitor Agent kaldırma betiği (Linux)
# Kullanım: sudo bash uninstall-agent.sh [--keep-logs]
set -euo pipefail

KEEP_LOGS=0
[ "${1:-}" = "--keep-logs" ] && KEEP_LOGS=1
[ "$(id -u)" -eq 0 ] || { echo "Bu betik root yetkisiyle çalıştırılmalıdır (sudo)." >&2; exit 1; }

BIN="/opt/tronmonitor/tronmonitor-agent"
if [ -x "$BIN" ]; then
  "$BIN" uninstall || true
fi
systemctl disable --now tronmonitor-agent >/dev/null 2>&1 || true
rm -f /etc/systemd/system/tronmonitor-agent.service
systemctl daemon-reload || true
rm -rf /opt/tronmonitor /usr/local/bin/tronmonitor-agent /etc/tronmonitor
[ "$KEEP_LOGS" -eq 1 ] || rm -rf /var/log/tronmonitor
echo "[TronMonitor] Ajan kaldırıldı. Sunucu kaydını panodan da kaldırmayı unutmayın."
