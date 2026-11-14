#!/usr/bin/env bash
# Save a known-good runtime snapshot (KV UI + public RP + tournament live + small canon files).
# Does NOT dump the whole 1.6G kv-cache — only files deploys/syncs have wiped before.
#
#   bash scripts/save_runtime_gold.sh
# Stamp dir: /var/backups/bb-runtime-gold/<YYYYMMDD_HHMM>/ + latest →
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CACHE="${KV_LOCAL_DIR:-$ROOT/data/kv-cache}"
GOLD_ROOT="${BB_RUNTIME_GOLD_ROOT:-/var/backups/bb-runtime-gold}"
STAMP="$(date +%Y%m%d_%H%M)"
DEST="$GOLD_ROOT/$STAMP"

has_growth() {
  local f="$1"
  [[ -f "$f" ]] && grep -q 'data-tm="growth"' "$f" && grep -q 'id="tm-growth"' "$f"
}

mkdir -p "$DEST/kv-ui" "$DEST/public" "$DEST/tournaments" "$DEST/kv-data" "$DEST/meta"

echo "==> save runtime gold → $DEST"

# --- KV UI (growth tab lives here) ---
for f in index.html app.js app-month.js tfs-fit.js styles.css cache-bust.json; do
  if [[ -f "$CACHE/$f" ]]; then
    cp -a "$CACHE/$f" "$DEST/kv-ui/$f"
  fi
done
mkdir -p "$DEST/kv-ui/public"
if [[ -f "$CACHE/public/index.html" ]]; then
  cp -a "$CACHE/public/index.html" "$DEST/kv-ui/public/index.html"
fi

# Refresh compact growth gold used by ensure_tm_growth_tab.sh
if has_growth "$CACHE/index.html"; then
  mkdir -p "$ROOT/data/kv-ui-backup"
  cp -a "$CACHE/index.html" "$ROOT/data/kv-ui-backup/index.html"
  cp -a "$CACHE/index.html" "$DEST/kv-ui/index.html"
  echo "  growth tab: OK (saved kv-ui-backup + gold)"
else
  echo "  WARN: served index has no «Развитие» — gold UI may be incomplete" >&2
fi

# --- Public RP canon (disk, not github.io) ---
for f in rp-ledger.json rp-ladder.json match-history.json; do
  if [[ -f "$ROOT/data/public/$f" ]]; then
    cp -a "$ROOT/data/public/$f" "$DEST/public/$f"
  fi
done

# --- Tournament live ---
if [[ -d "$ROOT/data/tournaments" ]]; then
  find "$ROOT/data/tournaments" -maxdepth 1 -type f \( -name '*.json' -o -name '*.md' \) \
    ! -name '*.lock' -print0 |
    while IFS= read -r -d '' f; do
      cp -a "$f" "$DEST/tournaments/$(basename "$f")"
    done
fi

# --- Tournament team logos (disk-only, not in git) ---
if [[ -d "$ROOT/storage/tournament-teams" ]]; then
  mkdir -p "$DEST/storage/tournament-teams"
  rsync -a --delete "$ROOT/storage/tournament-teams/" "$DEST/storage/tournament-teams/"
  echo "  tournament-teams logos: $(ls -1 "$DEST/storage/tournament-teams" 2>/dev/null | grep -cv '^\.' || echo 0)"
fi

# --- Small KV data that sync sometimes resets ---
for f in training-index.json tiers.json cache-bust.json; do
  if [[ -f "$CACHE/data/$f" ]]; then
    cp -a "$CACHE/data/$f" "$DEST/kv-data/$f"
  fi
done
# Current + previous training month calendars (not full players/)
for f in "$CACHE"/data/training/20[0-9][0-9]-[0-9][0-9].json; do
  [[ -f "$f" ]] || continue
  mkdir -p "$DEST/kv-data/training"
  cp -a "$f" "$DEST/kv-data/training/$(basename "$f")"
done
for f in accuracy-stats.json rp-ladder.json rp-ledger.json; do
  if [[ -f "$CACHE/data/training/$f" ]]; then
    mkdir -p "$DEST/kv-data/training"
    cp -a "$CACHE/data/training/$f" "$DEST/kv-data/training/$f"
  fi
done

# --- Manifest ---
{
  echo "savedAt=$(date -Is)"
  echo "host=$(hostname)"
  echo "platformHead=$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo '?')"
  echo "kvCache=$CACHE"
  echo "growth=$(has_growth "$CACHE/index.html" && echo yes || echo no)"
  echo "publicLedgerBytes=$(wc -c <"$ROOT/data/public/rp-ledger.json" 2>/dev/null | tr -d ' ' || echo 0)"
  echo "trainMonths=$(ls "$DEST/kv-data/training"/20*.json 2>/dev/null | wc -l | tr -d ' ')"
} >"$DEST/meta/manifest.txt"

# Keep last 8 stamps + latest symlink
ln -sfn "$DEST" "$GOLD_ROOT/latest"
mapfile -t OLD < <(ls -1dt "$GOLD_ROOT"/20* 2>/dev/null | tail -n +9 || true)
for d in "${OLD[@]:-}"; do
  [[ -n "$d" && -d "$d" ]] || continue
  rm -rf "$d"
done

du -sh "$DEST" | awk '{print "==> gold size "$1" → '"$DEST"'"}'
echo "==> latest → $GOLD_ROOT/latest"
cat "$DEST/meta/manifest.txt"
