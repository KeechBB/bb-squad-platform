#!/usr/bin/env bash
# Деплой платформы на VPS: pull → чистый билд (без старого .next) → pm2 restart
# Запуск: bash scripts/deploy.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> $(date -Is) deploy in $ROOT"
echo "==> git pull"
git pull --ff-only

echo "==> clear Next.js build cache (.next)"
rm -rf .next

echo "==> npm run build"
npm run build

echo "==> pm2 restart bb-squad"
if command -v pm2 >/dev/null 2>&1; then
  pm2 restart bb-squad
else
  echo "pm2 not found — restart manually" >&2
  exit 1
fi

echo "==> OK commit=$(git rev-parse --short HEAD) $(date -Is)"
