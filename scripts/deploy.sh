#!/usr/bin/env bash
# Деплой: pull → (стоп bb-squad только при нехватке RAM) → билд → restart
# На 2 ГБ стоп обязателен; на 4 ГБ обычно билдим на живом сайте.
# Запуск: bash scripts/deploy.sh
# Принудительный стоп: DEPLOY_STOP=1 bash scripts/deploy.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Порог: если available < этого (МиБ) — стопаем bb-squad перед билдом
MIN_AVAIL_MIB="${DEPLOY_MIN_AVAIL_MIB:-1800}"
STOPPED=0

ensure_swap() {
  if swapon --show 2>/dev/null | grep -q .; then
    echo "==> swap already on"
    return 0
  fi
  if [[ -f /swapfile ]]; then
    echo "==> enabling existing /swapfile"
    swapon /swapfile || true
    return 0
  fi
  echo "==> creating 2G /swapfile (one-time)"
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  if ! grep -q '^/swapfile ' /etc/fstab 2>/dev/null; then
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
  fi
}

avail_mib() {
  # колонка available у free -m (Mem)
  free -m | awk '/^Mem:/{print $7}'
}

echo "==> $(date -Is) deploy in $ROOT"
echo "==> git pull"
git pull --ff-only
echo "==> HEAD=$(git rev-parse --short HEAD)"

ensure_swap

if ! command -v pm2 >/dev/null 2>&1; then
  echo "pm2 not found" >&2
  exit 1
fi

AVAIL="$(avail_mib || echo 0)"
echo "==> free -h (before build)"
free -h || true
echo "==> Mem available ≈ ${AVAIL} MiB (stop if < ${MIN_AVAIL_MIB} or DEPLOY_STOP=1)"

if [[ "${DEPLOY_STOP:-0}" == "1" ]] || [[ "${AVAIL}" -lt "${MIN_AVAIL_MIB}" ]]; then
  echo "==> pm2 stop bb-squad (мало RAM / принудительно)"
  pm2 stop bb-squad || true
  STOPPED=1
else
  echo "==> keep bb-squad online during build (достаточно RAM)"
fi

echo "==> clear Next.js build cache (.next)"
rm -rf .next

echo "==> npm run build"
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=1536}"
npm run build

echo "==> pm2 restart bb-squad"
if [[ "$STOPPED" == "1" ]]; then
  pm2 start bb-squad || pm2 restart bb-squad
else
  pm2 restart bb-squad
fi

echo "==> free -h (after)"
free -h || true

echo "==> OK commit=$(git rev-parse --short HEAD) $(date -Is)"
