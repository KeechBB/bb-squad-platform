#!/usr/bin/env bash
# Полная автономия тиров Fit: пересчёт → автопереводы → зеркало kv-cache → лог.
# Cron (MSK): 15 1,13 * * *  root  .../run_tier_autonomy.sh
# После КВ: можно вызвать вручную или из пайплайна залива.
set -euo pipefail

PLATFORM="${BB_PLATFORM:-/var/www/bb-squad-platform}"
KV_PUBLIC="${BB_KV_PUBLIC:-/var/www/blackberry-kv}"
LOG_DIR="${PLATFORM}/logs"
LOG="${LOG_DIR}/tier-autonomy.log"
PY="${PLATFORM}/.venv/bin/python3"
[[ -x "$PY" ]] || PY="$(command -v python3)"

mkdir -p "$LOG_DIR"
exec >>"$LOG" 2>&1
echo "==== $(date -Is) tier autonomy start ===="

export BB_KV_PUBLIC="$KV_PUBLIC"
export KV_LOCAL_DIR="$KV_PUBLIC"

cd "$PLATFORM"

echo "[1/4] tier_fit_build"
"$PY" scripts/tier_fit_build.py

echo "[2/4] tier_autofit --apply"
"$PY" scripts/tier_autofit.py --apply

echo "[3/4] sync kv-cache → platform"
if [[ -x scripts/sync_kv_cache.sh ]]; then
  bash scripts/sync_kv_cache.sh || true
else
  mkdir -p "$PLATFORM/data/kv-cache"
  rsync -a --delete "$KV_PUBLIC"/ "$PLATFORM/data/kv-cache/" || true
fi

echo "[4/4] cache bust home tier board (touch)"
# Next unstable_cache keyed by time via revalidate — touch marker for ops
date -Is > "$PLATFORM/data/kv-cache/.tier-autonomy-ran" 2>/dev/null || true

echo "==== $(date -Is) tier autonomy done ===="
