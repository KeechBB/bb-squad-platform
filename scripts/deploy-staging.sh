#!/usr/bin/env bash
# Деплой ЧЕРНОВИКА (staging). Не трогает прод, без maintenance.on.
# Код: /var/www/bb-squad-platform-staging
# PM2: bb-squad-staging → :3001
# Запуск: bash scripts/deploy-staging.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BRANCH="${STAGING_BRANCH:-staging}"
PM2_NAME="${STAGING_PM2_NAME:-bb-squad-staging}"
PORT="${PORT:-3001}"

echo "==> $(date -Is) staging deploy in $ROOT (branch=$BRANCH port=$PORT)"

if [[ ! -f .env ]]; then
  echo "missing .env (need DATABASE_URL → bb_squad_staging, NEXTAUTH_URL=https://staging.bb-squad.ru)" >&2
  exit 1
fi

# Parent shell (bootstrap) may export prod DATABASE_URL — that overrides .env for Prisma/Next.
# Force-load staging .env keys and refuse to proceed if still pointing at prod DB name.
unset DATABASE_URL NEXTAUTH_URL PORT
set -a
# shellcheck disable=SC1090
source <(grep -E '^(DATABASE_URL|NEXTAUTH_URL|PORT)=' .env | sed 's/\r$//')
set +a
case "${DATABASE_URL:-}" in
  */bb_squad_staging*|*/bb_squad_staging\?*|*bb_squad_staging*)
    echo "==> DATABASE_URL → staging OK"
    ;;
  *)
    echo "REFUSING: DATABASE_URL is not bb_squad_staging: ${DATABASE_URL%%\?*}" >&2
    exit 1
    ;;
esac

echo "==> git fetch + checkout $BRANCH"
git fetch origin
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH" || git pull --ff-only || true
echo "==> HEAD=$(git rev-parse --short HEAD)"

# KV + public ledgers: всегда симлинк на прод (не дублируем гигабайты)
mkdir -p data
link_prod_data() {
  local name="$1"
  local prod="/var/www/bb-squad-platform/data/$name"
  local local_path="data/$name"
  if [[ -L "$local_path" ]]; then
    echo "==> $local_path already symlink → $(readlink -f "$local_path" 2>/dev/null || readlink "$local_path")"
    return 0
  fi
  if [[ -d "$prod" ]]; then
    rm -rf "$local_path"
    ln -sfn "$prod" "$local_path"
    echo "==> linked $local_path → $prod"
  else
    echo "==> WARN: missing $prod"
  fi
}
link_prod_data kv-cache
link_prod_data public
link_prod_data keech-hunt

if ! command -v pm2 >/dev/null 2>&1; then
  echo "pm2 not found" >&2
  exit 1
fi

echo "==> free -h (before build)"
free -h || true

# На 4 ГБ билдить рядом с живым Next (≈2–3 ГБ RSS) рискованно — на время
# билда staging гасим только сам staging; если RAM < 900 МБ available — кратко
# останавливаем прод (maintenance через prod deploy не трогаем).
PROD_STOPPED=0
AVAIL_MB="$(awk '/MemAvailable:/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 0)"
if [[ "${AVAIL_MB}" -lt 900 ]]; then
  echo "==> low RAM (${AVAIL_MB} MiB available) — briefly stop prod bb-squad for staging build"
  pm2 stop bb-squad 2>/dev/null || true
  PROD_STOPPED=1
fi

echo "==> pm2 stop $PM2_NAME (if running)"
pm2 stop "$PM2_NAME" 2>/dev/null || true

echo "==> clear .next"
rm -rf .next

echo "==> npm ci"
if [[ -f package-lock.json ]]; then
  npm ci || npm install
else
  npm install
fi

echo "==> prisma db push (staging DB only)"
npx prisma db push

echo "==> npm run build"
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=1536}"
npm run build

# Restore prod ASAP after build
if [[ "$PROD_STOPPED" == "1" ]]; then
  echo "==> restart prod bb-squad after staging build"
  pm2 start bb-squad || pm2 restart bb-squad || true
fi

echo "==> pm2 start/restart $PM2_NAME on :$PORT"
export PORT
NEXT_BIN="$ROOT/node_modules/next/dist/bin/next"
if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  PORT="$PORT" pm2 restart "$PM2_NAME" --update-env
else
  # Same style as prod: next start + ipv4first
  PORT="$PORT" pm2 start "$NEXT_BIN" \
    --name "$PM2_NAME" \
    --interpreter /usr/bin/node \
    --node-args="--dns-result-order=ipv4first" \
    -- start
fi
pm2 save || true

echo "==> free -h (after)"
free -h || true

echo "==> OK staging commit=$(git rev-parse --short HEAD) https://staging.bb-squad.ru $(date -Is)"
