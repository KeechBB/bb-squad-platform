#!/usr/bin/env bash
# After deploy / KV sync: restore critical runtime files from the last gold snapshot
# if they are missing or clearly broken. Safe no-op when gold is absent.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CACHE="${KV_LOCAL_DIR:-$ROOT/data/kv-cache}"
GOLD_ROOT="${BB_RUNTIME_GOLD_ROOT:-/var/backups/bb-runtime-gold}"
GOLD="${BB_RUNTIME_GOLD:-$GOLD_ROOT/latest}"

has_growth() {
  local f="$1"
  [[ -f "$f" ]] && grep -q 'data-tm="growth"' "$f" && grep -q 'id="tm-growth"' "$f"
}

if [[ ! -d "$GOLD" ]]; then
  echo "==> ensure_runtime_gold: no gold at $GOLD (run save_runtime_gold.sh first)"
  bash "$ROOT/scripts/ensure_tm_growth_tab.sh" || true
  exit 0
fi

echo "==> ensure runtime gold from $GOLD"

# Growth /tm UI
if ! has_growth "$CACHE/index.html"; then
  if has_growth "$GOLD/kv-ui/index.html"; then
    mkdir -p "$CACHE" "$CACHE/public" "$ROOT/data/kv-ui-backup"
    python3 "$ROOT/scripts/keep_live_edits.py" apply "$CACHE/index.html" "$GOLD/kv-ui/index.html"
    python3 "$ROOT/scripts/keep_live_edits.py" apply "$CACHE/public/index.html" "$GOLD/kv-ui/index.html"
    echo "  growth index checked against live copy"
  fi
fi
for f in app.js app-month.js tfs-fit.js; do
  if [[ -f "$GOLD/kv-ui/$f" && ! -f "$CACHE/$f" ]]; then
    cp -a "$GOLD/kv-ui/$f" "$CACHE/$f"
    echo "  restored kv-ui/$f"
  fi
done

# Public RP — disk is canon; never leave empty if gold has bytes
mkdir -p "$ROOT/data/public" "$CACHE/data/public"
for f in rp-ledger.json rp-ladder.json match-history.json; do
  live="$ROOT/data/public/$f"
  bak="$GOLD/public/$f"
  [[ -f "$bak" ]] || continue
  if [[ ! -f "$live" ]] || [[ ! -s "$live" ]]; then
    cp -a "$bak" "$live"
    echo "  restored data/public/$f"
  fi
  # Always mirror disk → kv-cache (never the other way)
  if [[ -f "$live" ]]; then
    cp -a "$live" "$CACHE/data/public/$f"
  fi
done

# Tournament live JSON
mkdir -p "$ROOT/data/tournaments"
if [[ -d "$GOLD/tournaments" ]]; then
  for f in "$GOLD/tournaments"/*.json; do
    [[ -f "$f" ]] || continue
    base="$(basename "$f")"
    live="$ROOT/data/tournaments/$base"
    if [[ ! -f "$live" ]] || [[ ! -s "$live" ]]; then
      cp -a "$f" "$live"
      echo "  restored tournaments/$base"
    fi
  done
fi

# Tournament team logos — restore any missing files from gold (never wipe live extras)
if [[ -d "$GOLD/storage/tournament-teams" ]]; then
  mkdir -p "$ROOT/storage/tournament-teams"
  restored=0
  for f in "$GOLD/storage/tournament-teams"/*; do
    [[ -f "$f" ]] || continue
    base="$(basename "$f")"
    [[ "$base" == .* ]] && continue
    live="$ROOT/storage/tournament-teams/$base"
    if [[ ! -f "$live" ]] || [[ ! -s "$live" ]]; then
      cp -a "$f" "$live"
      restored=$((restored + 1))
    fi
  done
  if [[ "$restored" -gt 0 ]]; then
    echo "  restored tournament-teams logos: $restored"
  fi
fi

# Training month calendars / index if wiped
mkdir -p "$CACHE/data/training"
if [[ -d "$GOLD/kv-data/training" ]]; then
  for f in "$GOLD/kv-data/training"/*; do
    [[ -f "$f" ]] || continue
    base="$(basename "$f")"
    live="$CACHE/data/training/$base"
    if [[ ! -f "$live" ]] || [[ ! -s "$live" ]]; then
      cp -a "$f" "$live"
      echo "  restored training/$base"
    fi
  done
fi
for f in training-index.json tiers.json index.json \
  rifle-ladder.json medic-ladder.json lat-ladder.json \
  mvp-ledger.json nick-patches.json factions.json orr.json; do
  if [[ -f "$GOLD/kv-data/$f" && ( ! -f "$CACHE/data/$f" || ! -s "$CACHE/data/$f" ) ]]; then
    mkdir -p "$CACHE/data"
    cp -a "$GOLD/kv-data/$f" "$CACHE/data/$f"
    echo "  restored data/$f"
  fi
done
# CW month calendars (hub «ближайшие КВ» читает их через index.json)
# Never replace a richer live calendar with a thinner gold copy.
mkdir -p "$CACHE/data"
if [[ -d "$GOLD/kv-data" ]]; then
  for f in "$GOLD/kv-data"/20[0-9][0-9]-[0-9][0-9].json; do
    [[ -f "$f" ]] || continue
    base="$(basename "$f")"
    live="$CACHE/data/$base"
    if [[ ! -f "$live" ]] || [[ ! -s "$live" ]]; then
      cp -a "$f" "$live"
      echo "  restored data/$base"
      continue
    fi
    # Guard: if live has fewer matches than gold, restore from gold
    live_n=$(python3 -c "import json; d=json.load(open('$live')); print(len(d.get('matches') or []))" 2>/dev/null || echo 0)
    gold_n=$(python3 -c "import json; d=json.load(open('$f')); print(len(d.get('matches') or []))" 2>/dev/null || echo 0)
    if [[ "${live_n:-0}" -lt "${gold_n:-0}" ]]; then
      cp -a "$live" "$live.bak-thin-$(date +%H%M%S)"
      cp -a "$f" "$live"
      echo "  restored thinner calendar $base live=$live_n gold=$gold_n"
    fi
  done
fi
# training-index must list current month; ladders must not be tiny stubs
if [[ -f "$GOLD/kv-data/training-index.json" && -f "$CACHE/data/training-index.json" ]]; then
  cur_ym=$(date +%Y-%m)
  if ! grep -q "$cur_ym" "$CACHE/data/training-index.json"; then
    cp -a "$CACHE/data/training-index.json" "$CACHE/data/training-index.json.bak-missing-month"
    cp -a "$GOLD/kv-data/training-index.json" "$CACHE/data/training-index.json"
    echo "  restored training-index (missing $cur_ym)"
  fi
fi
for ladder in rifle-ladder.json medic-ladder.json lat-ladder.json; do
  live="$CACHE/data/$ladder"
  goldf="$GOLD/kv-data/$ladder"
  [[ -f "$goldf" ]] || continue
  live_n=$(python3 -c "import json; d=json.load(open('$live')); print(len(d.get('players') or d.get('ladder') or []))" 2>/dev/null || echo 0)
  gold_n=$(python3 -c "import json; d=json.load(open('$goldf')); print(len(d.get('players') or d.get('ladder') or []))" 2>/dev/null || echo 0)
  if [[ ! -f "$live" ]] || [[ "${live_n:-0}" -lt 5 && "${gold_n:-0}" -ge 5 ]]; then
    [[ -f "$live" ]] && cp -a "$live" "$live.bak-stub"
    cp -a "$goldf" "$live"
    echo "  restored stub ladder $ladder live=$live_n gold=$gold_n"
  fi
done

# Growth kit tile images (Развитие cards): flat jpgs + factions/{staya,legion,...}/
# Earlier loop only copied files and skipped directories — factions/ vanished after deploy.
if [[ -d "$GOLD/kv-ui/assets/kits" ]]; then
  mkdir -p "$CACHE/assets/kits" "$CACHE/public/assets/kits"
  before=$(find "$CACHE/assets/kits" -type f 2>/dev/null | wc -l | tr -d ' ')
  rsync -a "$GOLD/kv-ui/assets/kits/" "$CACHE/assets/kits/"
  rsync -a "$GOLD/kv-ui/assets/kits/" "$CACHE/public/assets/kits/"
  after=$(find "$CACHE/assets/kits" -type f 2>/dev/null | wc -l | tr -d ' ')
  echo "  restored kit images: ${before} → ${after} (incl. factions/)"
fi

bash "$ROOT/scripts/ensure_tm_growth_tab.sh" || true
echo "==> ensure_runtime_gold done"
