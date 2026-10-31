#!/usr/bin/env bash
# Деплой: maintenance ON → pull → билд → pm2 restart → maintenance OFF
# Заглушка: public/maintenance.html (nginx смотрит на maintenance.on)
# Запуск: bash scripts/deploy.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# One build at a time. A second next build in the same tree corrupts .next
# and the failed one restores the previous site.
exec 9>/tmp/bb-deploy.lock
if ! flock -n 9; then
  echo "==> ABORT: another deploy is already running (/tmp/bb-deploy.lock)" >&2
  exit 1
fi

# Untracked screens live only on this disk. reset/pull does not put them in
# the build. Stop before maintenance, even if BB_DEPLOY_FORCE_CLEAN=1.
mapfile -t UNTRACKED_SRC < <(git status --porcelain -u -- src | sed -n 's/^?? //p' | grep -E '\.(ts|tsx)$' | grep -v -E '(^|/)_tmp' || true)
if [[ ${#UNTRACKED_SRC[@]} -gt 0 ]]; then
  echo "==> ABORT: untracked TypeScript in src/ on VPS. The live site is built only from GitHub." >&2
  echo "==> Commit these from the PC, push, then deploy again:" >&2
  printf '  %s\n' "${UNTRACKED_SRC[@]}" >&2
  exit 1
fi

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
# Canonical public RP lives ONLY under data/public/ — never let git wipe it.
PRESERVE_PUBLIC=(
  "data/public/rp-ledger.json"
  "data/public/rp-ladder.json"
  "data/public/match-history.json"
)
for f in "${PRESERVE_PUBLIC[@]}"; do
  if [[ -f "$f" ]]; then
    cp -a "$f" "$f.deploybak"
    echo "==> preserve $f"
  fi
done
# Vanilla minimaps are large — live on disk, not in git.
if [[ -d public/replay-maps ]]; then
  rm -rf /tmp/bb-replay-maps.bak
  cp -a public/replay-maps /tmp/bb-replay-maps.bak
  echo "==> preserve public/replay-maps"
fi
# CRITICAL: never stash-before-pull. Old deploy stashed SCP edits and never
# popped them → "lost" BP L5 / calendar / RP / Predator CSS after every deploy.
# Source of truth = GitHub. Dirty tree on VPS = abort (commit+push from PC first).
# checkout -- . / reset --hard запрещены.
mapfile -t DIRTY_PATHS < <(git status --porcelain -- src docs scripts package.json package-lock.json public 2>/dev/null | awk '{print $NF}' | grep -v '^public/replay-maps' || true)
if [[ "${BB_DEPLOY_FORCE_CLEAN:-}" == "1" ]]; then
  echo "==> BB_DEPLOY_FORCE_CLEAN=1 — fetch + reset --hard origin/main (only after GitHub has the truth)"
  git fetch origin
  git reset --hard origin/main
elif [[ ${#DIRTY_PATHS[@]} -gt 0 ]]; then
  echo "==> ABORT: dirty code on VPS (would be wiped by pull). Commit+push from PC, then redeploy." >&2
  echo "==> dirty paths:" >&2
  printf '  %s\n' "${DIRTY_PATHS[@]}" >&2
  echo "==> or after GitHub is correct: BB_DEPLOY_FORCE_CLEAN=1 bash scripts/deploy.sh" >&2
  exit 1
else
  git pull --ff-only
fi
# Some ops use reset --hard after fetch; restore preserved files either way.
for f in "${PRESERVE_PUBLIC[@]}"; do
  if [[ -f "$f.deploybak" ]]; then
    mv -f "$f.deploybak" "$f"
    echo "==> restored $f"
  fi
done
if [[ -d /tmp/bb-replay-maps.bak ]]; then
  mkdir -p public/replay-maps
  # Keep git-tracked files; fill in any missing PNGs from backup.
  cp -an /tmp/bb-replay-maps.bak/. public/replay-maps/ 2>/dev/null || true
  # Always restore disk PNGs over empty/missing after pull wipe.
  rsync -a /tmp/bb-replay-maps.bak/ public/replay-maps/
  echo "==> restored public/replay-maps"
  rm -rf /tmp/bb-replay-maps.bak
fi
echo "==> HEAD=$(git rev-parse --short HEAD)"

echo "==> sync local KV cache (rp-ladder / ledger / indexes)"
bash scripts/sync_kv_cache.sh || true
bash scripts/repair_train_live.sh || true
# Hard save: «Развитие» must survive every deploy (gold backup + fallback).
bash scripts/ensure_tm_growth_tab.sh || true

# Single source of truth: data/public/{rp-ledger,rp-ladder,match-history}.json
# Never pull public RP from kv-cache / github.io (that caused Farvort-class desync).
# One-way: if a legacy consumer still looks under kv-cache, mirror FROM disk only.
DISK_PUB="$ROOT/data/public"
KV_PUB="$ROOT/data/kv-cache/data/public"
mkdir -p "$KV_PUB"
for pubf in rp-ledger.json rp-ladder.json match-history.json; do
  if [[ -f "$DISK_PUB/$pubf" ]]; then
    cp -a "$DISK_PUB/$pubf" "$KV_PUB/$pubf"
    echo "==> mirror $pubf → kv-cache (disk is canonical)"
  fi
done

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

# Keep the live build. A failed compile or a failed gate puts it back
# and the old pages stay up. npm run build also drops webpack cache.
echo "==> park previous .next"
NEXT_BAK="$(mktemp -d /tmp/bb-next-bak.XXXXXX)"
if [[ -d .next ]]; then
  mv .next "$NEXT_BAK/next"
fi

restore_previous_build() {
  echo "==> restoring previous build" >&2
  rm -rf .next
  if [[ -d "$NEXT_BAK/next" ]]; then
    mv "$NEXT_BAK/next" .next
  fi
  if [[ -f "$ROOT/ecosystem.config.cjs" ]]; then
    pm2 start "$ROOT/ecosystem.config.cjs" --only bb-squad >/dev/null 2>&1 \
      || pm2 restart bb-squad || true
  else
    pm2 start bb-squad >/dev/null 2>&1 || pm2 restart bb-squad || true
  fi
  disable_maintenance
}

echo "==> npm ci (install deps for build)"
if [[ -f package-lock.json ]]; then
  npm ci || npm install
else
  npm install
fi

echo "==> prisma db push (schema)"
# skip-generate: client already from postinstall/npm ci; reinstall mid-push
# races with empty node_modules and exit 254.
npx prisma db push --skip-generate
npx prisma generate

echo "==> npm run build"
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=2048}"
set +e
npm run build
BUILD_RC=$?
set -e
if [[ "$BUILD_RC" -ne 0 ]]; then
  restore_previous_build
  exit "$BUILD_RC"
fi

# Next создаёт .next с правами 700. Nginx читает статику с диска от www-data
# и без прохода в каталог отдаёт 403, браузер показывает «client-side exception».
chmod 755 .next
find .next -type d ! -perm -005 -exec chmod 755 {} \;
find .next -type f ! -perm -004 -exec chmod 644 {} \;

echo "==> deploy gate (history columns + plaza covers disk matches)"
set +e
python3 scripts/check_deploy_gate.py
GATE_RC=$?
set -e
if [[ "$GATE_RC" -ne 0 ]]; then
  restore_previous_build
  exit "$GATE_RC"
fi
rm -rf "$NEXT_BAK"

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

echo "==> sys-load cron (CPU/RAM/NVMe, every minute)"
NODE_BIN="$(command -v node || true)"
if [[ -n "$NODE_BIN" ]]; then
  CRON_LINE="* * * * * cd $ROOT && $NODE_BIN scripts/sys-load-sample.mjs >> /var/log/bb-sys-load.log 2>&1"
  (crontab -l 2>/dev/null | grep -v 'sys-load-sample' || true; echo "$CRON_LINE") | crontab - || true
  "$NODE_BIN" scripts/sys-load-sample.mjs || true
fi

DEPLOY_OK=1
# Do NOT rebuild public rp-ledger in the background during deploy:
# the 30MB parse + python + pm2 restart was OOMing the 4GB box → 502 storms.
# Rebuild manually when needed: python3 scripts/build_public_rp_ledger.py

echo "==> warm public rating snapshot (disk cache for /public)"
curl -sk --max-time 120 -H 'Host: bb-squad.ru' \
  --resolve bb-squad.ru:443:127.0.0.1 \
  "https://127.0.0.1/api/warm/public-rating" || true

# Keep /public hot every minute (shared disk snapshot across cluster workers)
if [[ ! -f /etc/cron.d/bb-squad-warm-public ]]; then
  cat >/etc/cron.d/bb-squad-warm-public <<'EOF'
CRON_TZ=Europe/Moscow
* * * * * root curl -sk --max-time 90 -o /dev/null -H 'Host: bb-squad.ru' --resolve bb-squad.ru:443:127.0.0.1 https://127.0.0.1/api/warm/public-rating >/dev/null 2>&1
EOF
  chmod 644 /etc/cron.d/bb-squad-warm-public
fi

echo "==> attendance hourly publish cron (:00 MSK)"
chmod +x "$ROOT/scripts/publish_attendance_hourly.sh" 2>/dev/null || true
cat >/etc/cron.d/bb-attendance-hourly <<EOF
CRON_TZ=Europe/Moscow
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
0 * * * * root BB_PLATFORM_ROOT=$ROOT bash $ROOT/scripts/publish_attendance_hourly.sh >>/var/log/bb-attendance-hourly.log 2>&1
EOF
chmod 644 /etc/cron.d/bb-attendance-hourly
# Bootstrap snapshot so /home is not empty until next :00
bash "$ROOT/scripts/publish_attendance_hourly.sh" >>/var/log/bb-attendance-hourly.log 2>&1 || true

echo "==> BB train report cron (21:30 and 01:00 MSK)"
cat >/etc/cron.d/bb-train-report <<EOF
CRON_TZ=Europe/Moscow
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
30 21 * * * root cd $ROOT && python3 scripts/tr1_yavka_report.py data/BB-schedule-visits.xlsx --write-db --slot 2130 >>/var/log/bb-train-report.log 2>&1
0 1 * * * root cd $ROOT && python3 scripts/tr1_yavka_report.py data/BB-schedule-visits.xlsx --write-db --slot 0100 >>/var/log/bb-train-report.log 2>&1
EOF
chmod 644 /etc/cron.d/bb-train-report

echo "==> profile view files (separate process, a few players per minute)"
chmod +x "$ROOT/scripts/warm-profile-views.sh" 2>/dev/null || true
cat >/etc/cron.d/bb-profile-warm <<EOF
CRON_TZ=Europe/Moscow
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
* * * * * root flock -n /tmp/bb-profile-warm.lock env BB_PLATFORM_ROOT=$ROOT bash $ROOT/scripts/warm-profile-views.sh 3 >>/var/log/bb-profile-warm.log 2>&1
EOF
chmod 644 /etc/cron.d/bb-profile-warm

echo "==> ensure /tm «Развитие» still present (post-deploy save)"
bash scripts/ensure_tm_growth_tab.sh || true

echo "==> OK commit=$(git rev-parse --short HEAD) $(date -Is)"
