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

# GitHub Pages repo sometimes has content at ROOT, sometimes under public/.
# Monorepo = KV/public/. Prefer the tree that still has «Развитие» (growth tab) —
# root-of-repo copies have repeatedly wiped that tab on deploy.
SRC=""
pick_src() {
  local cand="$1"
  [[ -f "$cand/index.html" && -f "$cand/app.js" && -f "$cand/data/tiers.json" ]] || return 1
  SRC="$cand"
  return 0
}
src_has_growth() {
  local cand="$1"
  [[ -f "$cand/index.html" ]] && grep -q 'data-tm="growth"' "$cand/index.html"
}
# Prefer growth-enabled trees first (public/ / monorepo), then fall back.
if src_has_growth "$KV_REPO/public" && pick_src "$KV_REPO/public"; then
  :
elif src_has_growth "$ROOT/../KV/public" && pick_src "$ROOT/../KV/public"; then
  :
elif [[ -n "${KV_SRC_DIR:-}" ]] && src_has_growth "$KV_SRC_DIR" && pick_src "$KV_SRC_DIR"; then
  :
elif src_has_growth "$KV_REPO" && pick_src "$KV_REPO"; then
  :
elif pick_src "$KV_REPO/public"; then
  :
elif pick_src "$KV_REPO"; then
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

# Never deploy an index that drops «Развитие» over a cache that still has it.
if ! src_has_growth "$SRC"; then
  if src_has_growth "$DEST" || src_has_growth "$DEST/public"; then
    echo "==> WARN source has no growth tab — KEEP existing index.html (Развитие)" >&2
    KEEP_GROWTH_INDEX=1
  else
    echo "==> WARN source has no growth tab and cache also missing it" >&2
  fi
fi

echo "==> rsync $SRC/ → $DEST/ (verified source, growth=$(src_has_growth "$SRC" && echo yes || echo NO))"

# Preserve live auto-ingest (collector) — rsync must not wipe these.
TRAIN_BAK="$(mktemp -d /tmp/bb-train-bak.XXXXXX)"
if [[ -d "$DEST/data/training" ]]; then
  cp -a "$DEST/data/training" "$TRAIN_BAK/training"
  echo "==> backed up existing training → $TRAIN_BAK"
fi
mkdir -p "$TRAIN_BAK/public"
for pubf in rp-ledger.json rp-ladder.json match-history.json; do
  if [[ -f "$DEST/data/public/$pubf" ]]; then
    cp -a "$DEST/data/public/$pubf" "$TRAIN_BAK/public/$pubf" || true
  fi
done
if [[ -f "$DEST/data/cache-bust.json" ]]; then
  cp -a "$DEST/data/cache-bust.json" "$TRAIN_BAK/cache-bust.json" || true
fi
if [[ -f "$DEST/app.js" ]]; then
  cp -a "$DEST/app.js" "$TRAIN_BAK/app.js" || true
fi

if command -v rsync >/dev/null 2>&1; then
  # --delete only after source verified complete above.
  # NEVER rsync-wipe live training / public RP — collector writes these on VPS.
  # GitHub may lag; deploy must not resurrect empty Mutaha / drop pending RP.
  RSYNC_EXCL=(
    --exclude '.git/'
    --exclude '.github/'
    --exclude 'node_modules/'
    --exclude 'app-month.js'
    --exclude 'data/training/'
    --exclude 'data/training-index.json'
    --exclude 'data/players/'
    --exclude 'data/[0-9][0-9][0-9][0-9]-[0-9][0-9].json'
    --exclude 'data/public/rp-ledger.json'
    --exclude 'data/public/rp-ladder.json'
    --exclude 'data/public/match-history.json'
    --exclude 'data/cache-bust.json'
  )
  if [[ "${KEEP_GROWTH_INDEX:-0}" == "1" ]]; then
    RSYNC_EXCL+=(--exclude 'index.html')
  fi
  rsync -a --delete "${RSYNC_EXCL[@]}" "$SRC/" "$DEST/"
else
  # no rsync: copy over without wiping first (safer)
  cp -a "$SRC/." "$DEST/"
fi

# Ensure served root index always has «Развитие» if any copy does.
if ! src_has_growth "$DEST"; then
  if src_has_growth "$SRC"; then
    cp -a "$SRC/index.html" "$DEST/index.html"
    echo "==> restored growth index from $SRC"
  elif src_has_growth "$DEST/public"; then
    cp -a "$DEST/public/index.html" "$DEST/index.html"
    echo "==> restored growth index from $DEST/public"
  elif src_has_growth "$KV_REPO/public"; then
    cp -a "$KV_REPO/public/index.html" "$DEST/index.html"
    echo "==> restored growth index from $KV_REPO/public"
  fi
fi
# Keep nested public/index in sync with served root when root is the good one.
if src_has_growth "$DEST" && [[ -d "$DEST/public" ]]; then
  cp -a "$DEST/index.html" "$DEST/public/index.html"
fi

# Restore live training tree if rsync excluded it (always prefer disk backup)
if [[ -d "$TRAIN_BAK/training" ]]; then
  echo "==> restore live training (excluded from rsync wipe)"
  mkdir -p "$DEST/data"
  if [[ ! -d "$DEST/data/training" ]]; then
    cp -a "$TRAIN_BAK/training" "$DEST/data/training"
  else
    python3 "$ROOT/scripts/merge_train_after_kv_sync.py" "$TRAIN_BAK/training" "$DEST" || true
  fi
fi
# Merge any NEW month rows / players from GitHub that disk does not have yet
if [[ -d "$SRC/data/training" ]]; then
  echo "==> merge training from warehouse (add missing only)"
  python3 "$ROOT/scripts/merge_train_after_kv_sync.py" "$SRC/data/training" "$DEST" || true
fi
if [[ -f "$TRAIN_BAK/cache-bust.json" && ! -f "$DEST/data/cache-bust.json" ]]; then
  cp -a "$TRAIN_BAK/cache-bust.json" "$DEST/data/cache-bust.json" || true
fi
# kv-cache/public is a derived mirror only. Canon = $ROOT/data/public/ (never github.io).
mkdir -p "$DEST/data/public"
for pubf in rp-ledger.json rp-ladder.json match-history.json; do
  if [[ -f "$ROOT/data/public/$pubf" ]]; then
    cp -a "$ROOT/data/public/$pubf" "$DEST/data/public/$pubf" || true
  elif [[ -f "$TRAIN_BAK/public/$pubf" ]]; then
    cp -a "$TRAIN_BAK/public/$pubf" "$DEST/data/public/$pubf" || true
  fi
done
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

# Canon for home CW announce: keep nested public/data mirrors equal to data/*.json
# (иначе точечный scp в data/ оставляет public/data устаревшим).
if [[ -d "$DEST/data" ]]; then
  mkdir -p "$DEST/public/data"
  find "$DEST/data" -maxdepth 1 -type f -name '20[0-9][0-9]-[0-9][0-9].json' -print0 |
    while IFS= read -r -d '' f; do
      base="$(basename "$f")"
      cp -a "$f" "$DEST/public/data/$base"
    done
  echo "==> mirrored month JSON data/ → public/data/ (home + pages)"
fi

# Always keep «Развитие» after sync (save gold backup / restore if wiped).
bash "$ROOT/scripts/ensure_tm_growth_tab.sh" || true

# count JSON as sanity
json_n=$(find "$DEST/data" -type f -name '*.json' 2>/dev/null | wc -l | tr -d ' ')
echo "==> KV cache sync done (json files in data/: $json_n)"
exit 0
