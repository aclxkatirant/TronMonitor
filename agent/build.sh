#!/usr/bin/env bash
# TronMonitor Agent - tüm hedefler için yerel ikili dosyaları derler ve SHA256 özetlerini yazar.
# Kullanım: ./build.sh [sürüm]
set -euo pipefail
cd "$(dirname "$0")"

VERSION="${1:-0.1.0}"
OUT_DIR="${OUT_DIR:-dist}"
COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
PKG="github.com/aclxkatirant/TronMonitor/agent/internal/buildinfo"
LDFLAGS="-s -w -X ${PKG}.Version=${VERSION} -X ${PKG}.Commit=${COMMIT} -X ${PKG}.BuildDate=${DATE}"

mkdir -p "$OUT_DIR"
rm -f "$OUT_DIR/SHA256SUMS"

build() {
  local os="$1" arch="$2" name="$3"
  echo "Derleniyor: ${os}/${arch} -> ${OUT_DIR}/${name}"
  CGO_ENABLED=0 GOOS="$os" GOARCH="$arch" go build -trimpath -ldflags "$LDFLAGS" -o "${OUT_DIR}/${name}" ./cmd/tronmonitor-agent
  (cd "$OUT_DIR" && sha256sum "$name" >> SHA256SUMS)
}

build windows amd64 tronmonitor-agent-windows-amd64.exe
build windows arm64 tronmonitor-agent-windows-arm64.exe
build linux amd64 tronmonitor-agent-linux-amd64
build linux arm64 tronmonitor-agent-linux-arm64

echo "Tamamlandı. Özetler: ${OUT_DIR}/SHA256SUMS"
cat "${OUT_DIR}/SHA256SUMS"
