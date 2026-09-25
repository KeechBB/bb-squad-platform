#!/usr/bin/env bash
# Деплой платформы на VPS: pull → стоп pm2 → билд → старт
# На 2 ГБ RAM нельзя одновременно держать next-server и next build — OOM killer.
# Запуск: bash scripts/deploy.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ensure_swap() {
  # 2G swap, если ещё нет — иначе next build часто убивают на 2 ГБ тарифе
  if swapon --show | grep -q .; then
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

if command -v pm2 >/dev/null 2>&1; then
  echo "==> pm2 stop bb-squad (free RAM for build)"
  pm2 stop bb-squad || true
  # коллектор лёгкий — можно не трогать; если опять OOM — раскомментируй:
  # pm2 stop bb-squad-collector || true
else
  echo "pm2 not found" >&2
  exit 1
fi

echo "==> free -h (before build)"
free -h || true

echo "==> clear Next.js build cache (.next)"
rm -rf .next

echo "==> npm run build"
# чуть меньше heap, чтобы вместе со swap не раздувать anon-rss без меры
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=1536}"
npm run build

echo "==> pm2 start/restart bb-squad"
pm2 start bb-squad || pm2 restart bb-squad
# pm2 start bb-squad-collector || true

echo "==> free -h (after)"
free -h || true

echo "==> OK commit=$(git rev-parse --short HEAD) $(date -Is)"
