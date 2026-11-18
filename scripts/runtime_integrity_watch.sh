#!/usr/bin/env bash
# Auto-heal critical KV runtime. Safe to run often (cron every 15m).
# - ensure_runtime_gold (thin calendars / stub ladders / missing month)
# - refuse-state checks + alert log
# - never rsync --delete
set -euo pipefail

ROOT="${BB_PLATFORM_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
CACHE="${KV_LOCAL_DIR:-$ROOT/data/kv-cache}"
LOG="${BB_RUNTIME_WATCH_LOG:-/var/log/bb-runtime-integrity.log}"
ALERT="${BB_RUNTIME_ALERT_FILE:-/tmp/bb-runtime-integrity-ALERT}"

mkdir -p "$(dirname "$LOG")"
ts() { date -Is; }

{
  echo "$(ts) == runtime integrity watch =="
  bash "$ROOT/scripts/ensure_runtime_gold.sh" || echo "$(ts) WARN ensure_runtime_gold failed"

  DATA="$CACHE/data"
  fail=0

  # training-index must include current month
  cur=$(date +%Y-%m)
  if [[ -f "$DATA/training-index.json" ]]; then
    if ! grep -q "$cur" "$DATA/training-index.json"; then
      echo "$(ts) ALERT training-index missing $cur"
      fail=1
    fi
  else
    echo "$(ts) ALERT training-index.json MISSING"
    fail=1
  fi

  # CW calendar current month must exist and have matches
  cal="$DATA/$cur.json"
  if [[ ! -f "$cal" ]]; then
    echo "$(ts) ALERT calendar $cur.json MISSING"
    fail=1
  else
    n=$(python3 -c "import json; print(len(json.load(open('$cal')).get('matches') or []))" 2>/dev/null || echo 0)
    if [[ "${n:-0}" -lt 1 ]]; then
      echo "$(ts) ALERT calendar $cur.json empty matches"
      fail=1
    else
      echo "$(ts) calendar $cur matches=$n"
    fi
  fi

  # ladders not stubs
  for ladder in rifle-ladder.json medic-ladder.json lat-ladder.json; do
    f="$DATA/$ladder"
    if [[ ! -f "$f" ]]; then
      echo "$(ts) ALERT $ladder MISSING"
      fail=1
      continue
    fi
    n=$(python3 -c "import json;d=json.load(open('$f')); print(len(d.get('players') or d.get('ladder') or []))" 2>/dev/null || echo 0)
    if [[ "${n:-0}" -lt 5 ]]; then
      echo "$(ts) ALERT $ladder stub n=$n"
      fail=1
    else
      echo "$(ts) $ladder players=$n"
    fi
  done

  # kits present
  kits=$(ls -1 "$CACHE/assets/kits"/*.jpg 2>/dev/null | wc -l | tr -d ' ')
  if [[ "${kits:-0}" -lt 8 ]]; then
    echo "$(ts) ALERT kits jpg count=$kits"
    fail=1
  else
    echo "$(ts) kits=$kits"
  fi

  # public RP disk canon not empty
  for f in rp-ledger.json rp-ladder.json; do
    live="$ROOT/data/public/$f"
    sz=$(wc -c <"$live" 2>/dev/null | tr -d ' ' || echo 0)
    if [[ "${sz:-0}" -lt 1000 ]]; then
      echo "$(ts) ALERT public $f size=$sz"
      fail=1
    else
      echo "$(ts) public $f size=$sz"
    fi
  done

  if [[ "$fail" -ne 0 ]]; then
    echo "$(ts) FAIL — running ensure again + keeping alert flag"
    bash "$ROOT/scripts/ensure_runtime_gold.sh" || true
    echo "$(ts) integrity FAIL" >"$ALERT"
    exit 1
  fi

  rm -f "$ALERT"
  echo "$(ts) OK"
} >>"$LOG" 2>&1
