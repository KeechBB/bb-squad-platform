#!/usr/bin/env bash
# Деплой: pull → билд на живом сайте → pm2 restart
# bb-squad не стопаем (на 4 ГБ RAM хватает). Принудительный стоп: DEPLOY_STOP=1
# Запуск: bash scripts/deploy.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

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

echo "==> $(date -Is) deploy in $ROOT"
echo "==> git pull"
git pull --ff-only
echo "==> HEAD=$(git rev-parse --short HEAD)"

ensure_swap

if ! command -v pm2 >/dev/null 2>&1; then
  echo "pm2 not found" >&2
  exit 1
fi

echo "==> free -h (before build)"
free -h || true

# По умолчанию сайт не гасим. Только явный DEPLOY_STOP=1.
if [[ "${DEPLOY_STOP:-0}" == "1" ]]; then
  echo "==> pm2 stop bb-squad (DEPLOY_STOP=1)"
  pm2 stop bb-squad || true
  STOPPED=1
else
  echo "==> keep bb-squad online during build"
fi

echo "==> clear Next.js build cache (.next)"
rm -rf .next

echo "==> npm run build"
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=2048}"
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
