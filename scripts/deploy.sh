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
    python3 - <<PY || true
import sys
sys.path.insert(0, "$ROOT/scripts")
import bb_alerts as A
A.deploy_ok("$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo '?')")
PY
  else
    echo "==> deploy FAILED — leave maintenance.on (fix when ready, then: rm -f $MAINT_FLAG && nginx -s reload)" >&2
    python3 - <<PY || true
import sys
sys.path.insert(0, "$ROOT/scripts")
import bb_alerts as A
A.deploy_fail("deploy.sh завершился с ошибкой; maintenance.on может остаться")
PY
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
bash scripts/repair_train_live.sh || true

# Public rating reads data/public/rp-ledger.json first; deploy used to restore a
# preserved stale copy and ignore the fresher github.io mirror in kv-cache.
# Prefer the copy with MORE scored matches (mtime alone can overwrite a fuller
# VPS ledger with a thinner github.io rebuild).
KV_PUB_LEDGER="$ROOT/data/kv-cache/data/public/rp-ledger.json"
DISK_PUB_LEDGER="$ROOT/data/public/rp-ledger.json"
KV_PUB_LADDER="$ROOT/data/kv-cache/data/public/rp-ladder.json"
DISK_PUB_LADDER="$ROOT/data/public/rp-ladder.json"
ledger_match_count() {
  local f="$1"
  [[ -f "$f" ]] || { echo 0; return; }
  python3 - "$f" <<'PY' 2>/dev/null || echo 0
import json,sys
try:
  d=json.load(open(sys.argv[1],encoding="utf-8"))
  print(len(d.get("matches") or []))
except Exception:
  print(0)
PY
}
if [[ -f "$KV_PUB_LEDGER" ]]; then
  mkdir -p "$(dirname "$DISK_PUB_LEDGER")"
  KV_N="$(ledger_match_count "$KV_PUB_LEDGER")"
  DISK_N="$(ledger_match_count "$DISK_PUB_LEDGER")"
  if [[ ! -f "$DISK_PUB_LEDGER" ]] || [[ "$KV_N" -gt "$DISK_N" ]]; then
    cp -a "$KV_PUB_LEDGER" "$DISK_PUB_LEDGER"
    echo "==> refreshed $DISK_PUB_LEDGER from kv-cache (matches $DISK_N → $KV_N)"
    if [[ -f "$KV_PUB_LADDER" ]]; then
      cp -a "$KV_PUB_LADDER" "$DISK_PUB_LADDER"
      echo "==> refreshed $DISK_PUB_LADDER from kv-cache"
    fi
  else
    echo "==> keep disk ledger (matches disk=$DISK_N kv=$KV_N)"
  fi
fi

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

echo "==> pm2 start/restart bb-squad (ecosystem: heap cap + max_memory_restart)"
if [[ -f "$ROOT/ecosystem.config.cjs" ]]; then
  # delete+start подхватывает NODE_OPTIONS / max_memory_restart из файла
  pm2 delete bb-squad >/dev/null 2>&1 || true
  pm2 start "$ROOT/ecosystem.config.cjs" --only bb-squad
  pm2 save >/dev/null 2>&1 || true
elif [[ "$STOPPED" == "1" ]]; then
  pm2 start bb-squad || pm2 restart bb-squad
else
  pm2 restart bb-squad
fi

# Hunt / log tail live in the collector process — must reload Python after pull.
echo "==> pm2 restart bb-squad-collector (Hunt Wound/noks + log parsers)"
pm2 restart bb-squad-collector || true

echo "==> free -h (after)"
free -h || true

echo "==> BB clan: training players → clan + CW stacks by play frequency"
python3 scripts/sync_bb_clan_from_training.py --apply || true
python3 scripts/sync_bb_squads_from_kv.py --apply || true

DEPLOY_OK=1
# Do NOT rebuild public rp-ledger in the background during deploy:
# the 30MB parse + python + pm2 restart was OOMing the 4GB box → 502 storms.
# Rebuild manually when needed: python3 scripts/build_public_rp_ledger.py

echo "==> OK commit=$(git rev-parse --short HEAD) $(date -Is)"
