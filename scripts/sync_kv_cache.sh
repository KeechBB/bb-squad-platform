#!/usr/bin/env bash
# Mirror hot KV JSON onto the VPS disk for local reads (fallback remains github.io).
# Called from deploy.sh. Can also run via cron: */15 * * * * …
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${KV_LOCAL_DIR:-$ROOT/data/kv-cache}"
BASE="${KV_DATA_BASE:-https://keechbb.github.io/blackberry-kv}"
BASE="${BASE%/}"

mkdir -p "$DEST/data/training" "$DEST/data"

FILES=(
  "data/training/rp-ladder.json"
  "data/training/rp-ledger.json"
  "data/training-index.json"
  "data/tiers.json"
  "data/tier-board.json"
  "data/public/rp-ladder.json"
  "data/public/rp-ledger.json"
  "data/2026-10.json"
)

echo "==> sync KV cache → $DEST (from $BASE)"
ok=0
fail=0
for rel in "${FILES[@]}"; do
  url="$BASE/$rel"
  out="$DEST/$rel"
  mkdir -p "$(dirname "$out")"
  tmp="$out.tmp.$$"
  if curl -fsSL --max-time 120 -o "$tmp" "$url"; then
    # reject empty / HTML error pages
    if [[ ! -s "$tmp" ]] || head -c 20 "$tmp" | grep -qi '<!DOCTYPE\|<html'; then
      echo "  skip $rel (empty or HTML)"
      rm -f "$tmp"
      fail=$((fail + 1))
      continue
    fi
    mv -f "$tmp" "$out"
    sz=$(wc -c <"$out" | tr -d ' ')
    echo "  ok   $rel ($sz bytes)"
    ok=$((ok + 1))
  else
    rm -f "$tmp"
    echo "  fail $rel"
    fail=$((fail + 1))
  fi
done

# Also seed from sibling KV checkout if present (dev / same-box).
KV_SRC="${KV_SRC_DIR:-$ROOT/../KV/public}"
if [[ -d "$KV_SRC/data" ]]; then
  for rel in "${FILES[@]}"; do
    src="$KV_SRC/$rel"
    if [[ -f "$src" ]]; then
      mkdir -p "$(dirname "$DEST/$rel")"
      # Prefer fresher of remote vs local sibling
      if [[ ! -f "$DEST/$rel" ]] || [[ "$src" -nt "$DEST/$rel" ]]; then
        cp -a "$src" "$DEST/$rel"
        echo "  seed $rel ← sibling KV"
      fi
    fi
  done
fi

echo "==> KV cache sync done ok=$ok fail=$fail"
# Never fail deploy solely because GitHub Pages is slow
exit 0
