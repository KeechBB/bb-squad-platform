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

SRC=""
if [[ -d "$KV_REPO/public" ]]; then
  SRC="$KV_REPO/public"
elif [[ -n "${KV_SRC_DIR:-}" && -d "${KV_SRC_DIR}/data" ]]; then
  SRC="$KV_SRC_DIR"
elif [[ -d "$ROOT/../KV/public/data" ]]; then
  SRC="$ROOT/../KV/public"
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

for must in index.html app.js data/tiers.json; do
  if [[ ! -f "$DEST/$must" ]]; then
    echo "==> WARN missing after sync: $DEST/$must" >&2
  else
    sz=$(wc -c <"$DEST/$must" | tr -d ' ')
    echo "  ok $must ($sz bytes)"
  fi
done

# count JSON as sanity
json_n=$(find "$DEST/data" -type f -name '*.json' 2>/dev/null | wc -l | tr -d ' ')
echo "==> KV cache sync done (json files in data/: $json_n)"
exit 0
