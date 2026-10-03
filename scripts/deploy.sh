#!/usr/bin/env bash
# Деплой: maintenance ON → pull → билд → pm2 restart → maintenance OFF
# Заглушка: public/maintenance.html (nginx смотрит на maintenance.on)
# Запуск: bash scripts/deploy.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MAINT_FLAG="$ROOT/maintenance.on"
DEPLOY_OK=0
STOPPED=0

enable_maintenance() {
  touch "$MAINT_FLAG"
  echo "==> maintenance ON ($MAINT_FLAG)"
  if command -v nginx >/dev/null 2>&1; then
    nginx -t >/dev/null 2>&1 && nginx -s reload 2>/dev/null || true
  fi
}

disable_maintenance() {
  rm -f "$MAINT_FLAG"
  echo "==> maintenance OFF"
  if command -v nginx >/dev/null 2>&1; then
    nginx -t >/dev/null 2>&1 && nginx -s reload 2>/dev/null || true
  fi
}

cleanup() {
  if [[ "$DEPLOY_OK" == "1" ]]; then
    disable_maintenance
  else
    echo "==> deploy FAILED — leave maintenance.on (fix when ready, then: rm -f $MAINT_FLAG && nginx -s reload)" >&2
  fi
}
trap cleanup EXIT

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

enable_maintenance

echo "==> git pull"
# Runtime public data lives on disk / DB — never let hard-reset wipe a fuller ledger.
PRESERVE_PUBLIC=(
  "data/public/rp-ledger.json"
  "data/public/match-history.json"
)
for f in "${PRESERVE_PUBLIC[@]}"; do
  if [[ -f "$f" ]]; then
    cp -a "$f" "$f.deploybak"
    echo "==> preserve $f"
  fi
done
git pull --ff-only || true
# Some ops use reset --hard after fetch; restore preserved files either way.
for f in "${PRESERVE_PUBLIC[@]}"; do
  if [[ -f "$f.deploybak" ]]; then
    mv -f "$f.deploybak" "$f"
    echo "==> restored $f"
  fi
done
echo "==> HEAD=$(git rev-parse --short HEAD)"

echo "==> sync local KV cache (rp-ladder / ledger / indexes)"
bash scripts/sync_kv_cache.sh || true

ensure_swap

if ! command -v pm2 >/dev/null 2>&1; then
  echo "pm2 not found" >&2
  exit 1
fi

echo "==> free -h (before build)"
free -h || true

# На время билда гасим Next — иначе без .next отдаёт «голый» HTML.
# Заглушку показывает nginx по maintenance.on
echo "==> pm2 stop bb-squad (maintenance page)"
pm2 stop bb-squad || true
STOPPED=1

echo "==> clear Next.js build cache (.next)"
rm -rf .next

echo "==> npm ci (install deps for build)"
if [[ -f package-lock.json ]]; then
  npm ci || npm install
else
  npm install
fi

echo "==> prisma db push (schema)"
npx prisma db push

echo "==> npm run build"
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=2048}"
npm run build

echo "==> pm2 start/restart bb-squad"
if [[ "$STOPPED" == "1" ]]; then
  pm2 start bb-squad || pm2 restart bb-squad
else
  pm2 restart bb-squad
fi

# Hunt / log tail live in the collector process — must reload Python after pull.
echo "==> pm2 restart bb-squad-collector (Hunt Wound/noks + log parsers)"
pm2 restart bb-squad-collector || true

echo "==> free -h (after)"
free -h || true

DEPLOY_OK=1
# Kick async public RP rebuild (DB history + logs) so Каток never stays on a thin git seed.
if [[ -f scripts/build_public_rp_ledger.py ]]; then
  echo "==> kick public RP rebuild (background)"
  (
    set -a
    [[ -f .env ]] && . ./.env
    set +a
    python3 scripts/build_public_rp_ledger.py >>scripts/_tmp_public_rp_rebuild.log 2>&1
    pm2 restart bb-squad >/dev/null 2>&1 || true
  ) &
fi

echo "==> OK commit=$(git rev-parse --short HEAD) $(date -Is)"
