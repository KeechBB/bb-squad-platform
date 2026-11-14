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
for f in training-index.json tiers.json; do
  if [[ -f "$GOLD/kv-data/$f" && ( ! -f "$CACHE/data/$f" || ! -s "$CACHE/data/$f" ) ]]; then
    mkdir -p "$CACHE/data"
    cp -a "$GOLD/kv-data/$f" "$CACHE/data/$f"
    echo "  restored data/$f"
  fi
done

bash "$ROOT/scripts/ensure_tm_growth_tab.sh" || true
echo "==> ensure_runtime_gold done"
