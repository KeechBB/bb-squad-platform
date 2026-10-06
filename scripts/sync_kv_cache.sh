#!/usr/bin/env bash
# Full mirror of KV public → VPS disk (data/kv-cache).
# Hot path (/kv-static, home APIs) reads ONLY from this disk — no GitHub Pages CDN.
#
# SAFETY: never wipes existing cache if source is missing/broken.
# We COPY/UPDATE from a verified source. GitHub *repo* stays as backup warehouse;
# only live pageviews stop hitting github.io.
#
# Sources (first that works):
#   1) /var/www/blackberry-kv/public  (git pull)
#   2) $KV_SRC_DIR or ../KV/public
#
# Called from deploy.sh. Cron OK: */15 * * * *
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${KV_LOCAL_DIR:-$ROOT/data/kv-cache}"
KV_REPO="${KV_REPO_DIR:-/var/www/blackberry-kv}"
# Used only to clone/pull the warehouse onto VPS — not for browser traffic.
KV_GIT_URL="${KV_GIT_URL:-https://github.com/KeechBB/blackberry-kv.git}"

mkdir -p "$DEST"

echo "==> sync KV cache → $DEST"

# --- ensure repo on VPS (does not delete existing clone) ---
if [[ ! -d "$KV_REPO/.git" ]]; then
  if [[ -n "$KV_GIT_URL" ]]; then
    echo "==> clone $KV_GIT_URL → $KV_REPO (first time)"
    mkdir -p "$(dirname "$KV_REPO")"
    if ! git clone --depth 1 "$KV_GIT_URL" "$KV_REPO"; then
      echo "==> WARN clone failed — keeping existing $DEST untouched" >&2
    fi
  fi
fi

if [[ -d "$KV_REPO/.git" ]]; then
  echo "==> git pull $KV_REPO"
  git -C "$KV_REPO" pull --ff-only || echo "==> WARN git pull failed — will use whatever is already on disk" >&2
fi

# GitHub Pages repo = content at ROOT (index.html next to data/).
# Local monorepo = KV/public/. Prefer whichever has a complete tree.
SRC=""
pick_src() {
  local cand="$1"
  [[ -f "$cand/index.html" && -f "$cand/app.js" && -f "$cand/data/tiers.json" ]] || return 1
  SRC="$cand"
  return 0
}
if pick_src "$KV_REPO"; then
  :
elif pick_src "$KV_REPO/public"; then
  :
elif [[ -n "${KV_SRC_DIR:-}" ]] && pick_src "$KV_SRC_DIR"; then
  :
elif pick_src "$ROOT/../KV/public"; then
  :
fi

if [[ -z "$SRC" ]]; then
  echo "==> ERROR: no KV source found" >&2
  echo "==> KEEP existing cache as-is: $DEST"
  exit 0
fi

# --- verify source looks complete before touching DEST ---
for must in index.html app.js data/tiers.json; do
  if [[ ! -f "$SRC/$must" ]]; then
    echo "==> ERROR: source incomplete (missing $must) — KEEP existing $DEST" >&2
    exit 0
  fi
done

echo "==> rsync $SRC/ → $DEST/ (verified source)"

# Preserve richer auto-train data that GitHub may not have yet (collector writes live).
TRAIN_BAK="$(mktemp -d /tmp/bb-train-bak.XXXXXX)"
if [[ -d "$DEST/data/training" ]]; then
  cp -a "$DEST/data/training" "$TRAIN_BAK/training"
  echo "==> backed up existing training → $TRAIN_BAK"
fi
if [[ -f "$DEST/data/cache-bust.json" ]]; then
  cp -a "$DEST/data/cache-bust.json" "$TRAIN_BAK/cache-bust.json" || true
fi
if [[ -f "$DEST/app.js" ]]; then
  cp -a "$DEST/app.js" "$TRAIN_BAK/app.js" || true
fi

if command -v rsync >/dev/null 2>&1; then
  # --delete only after source verified complete above
  rsync -a --delete \
    --exclude '.git/' \
    --exclude '.github/' \
    --exclude 'node_modules/' \
    "$SRC/" "$DEST/"
else
  # no rsync: copy over without wiping first (safer)
  cp -a "$SRC/." "$DEST/"
fi

# Merge back auto-ingest if disk had more matches than GitHub warehouse
if [[ -d "$TRAIN_BAK/training" ]]; then
  echo "==> merge training (add missing only; never wipe GitHub; scrub Yehorivka)"
  python3 "$ROOT/scripts/merge_train_after_kv_sync.py" "$TRAIN_BAK/training" "$DEST" || true
  # always scrub junk even if backup missing
  python3 "$ROOT/scripts/merge_train_after_kv_sync.py" "$DEST/data/training" "$DEST" || true
fi
rm -rf "$TRAIN_BAK"

# Scrub junk (Yehorivka) and verify UI files
python3 "$ROOT/scripts/merge_train_after_kv_sync.py" "$DEST/data/training" "$DEST" 2>/dev/null || true

for must in index.html app.js data/tiers.json; do
  if [[ ! -f "$DEST/$must" ]]; then
    echo "==> WARN missing after sync: $DEST/$must" >&2
  else
    sz=$(wc -c <"$DEST/$must" | tr -d ' ')
    echo "  ok $must ($sz bytes)"
  fi
done

# If Yehorivka leaked back or time column missing — force from GitHub warehouse
NEED_REPAIR=0
if [[ -f "$DEST/data/training/2026-10.json" ]] && grep -qi yehorivka "$DEST/data/training/2026-10.json" 2>/dev/null; then
  NEED_REPAIR=1
fi
if [[ -f "$DEST/index.html" ]] && ! grep -q 'Время' "$DEST/index.html" 2>/dev/null; then
  NEED_REPAIR=1
fi
if [[ "$NEED_REPAIR" -eq 1 ]]; then
  echo "==> repair_train_live.sh (Yehorivka or missing time column)"
  bash "$ROOT/scripts/repair_train_live.sh" || true
fi

# count JSON as sanity
json_n=$(find "$DEST/data" -type f -name '*.json' 2>/dev/null | wc -l | tr -d ' ')
echo "==> KV cache sync done (json files in data/: $json_n)"
exit 0
