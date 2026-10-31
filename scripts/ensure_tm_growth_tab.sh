#!/usr/bin/env bash
# After every KV sync / deploy: keep «Развитие» (data-tm=growth) on the served /tm index.
# Saves a gold backup whenever the tab is present; restores it if sync wiped the tab.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CACHE="${KV_LOCAL_DIR:-$ROOT/data/kv-cache}"
BACKUP_DIR="$ROOT/data/kv-ui-backup"
GOLD="$BACKUP_DIR/index.html"
SERVED="$CACHE/index.html"
NESTED="$CACHE/public/index.html"
KV_REPO="${KV_REPO_DIR:-/var/www/blackberry-kv}"

has_growth() {
  local f="$1"
  [[ -f "$f" ]] && grep -q 'data-tm="growth"' "$f" && grep -q 'id="tm-growth"' "$f"
}

bust_script() {
  local f="$1"
  [[ -f "$f" ]] || return 0
  # force browsers to reload app-month after index restore
  local stamp
  stamp="$(date +%Y%m%d%H%M)"
  sed -i "s/app-month\\.js?v=[^\"]*/app-month.js?v=${stamp}-growth/" "$f" 2>/dev/null || true
}

mkdir -p "$BACKUP_DIR" "$CACHE"

# 1) If served index is good — refresh gold backup (this is the durable save).
if has_growth "$SERVED"; then
  cp -a "$SERVED" "$GOLD"
  mkdir -p "$CACHE/public"
  cp -a "$SERVED" "$NESTED"
  bust_script "$SERVED"
  bust_script "$NESTED"
  echo "==> growth tab OK — saved gold backup → $GOLD"
  exit 0
fi

echo "==> WARN: served index missing «Развитие» — restoring" >&2

restore_from() {
  local src="$1"
  if has_growth "$src"; then
    cp -a "$src" "$SERVED"
    mkdir -p "$CACHE/public"
    cp -a "$src" "$NESTED"
    cp -a "$src" "$GOLD"
    bust_script "$SERVED"
    bust_script "$NESTED"
    echo "==> restored growth index from $src"
    return 0
  fi
  return 1
}

# 2) Prefer last good backup from previous deploys
restore_from "$GOLD" && exit 0

# 3) Nested / repo / monorepo copies
restore_from "$NESTED" && exit 0
restore_from "$KV_REPO/public/index.html" && exit 0
restore_from "$KV_REPO/index.html" && exit 0
restore_from "$ROOT/../KV/public/index.html" && exit 0

# 4) Platform-shipped fallback (committed)
restore_from "$ROOT/data/kv-ui-fallback/index.html" && exit 0

echo "==> ERROR: no growth-capable index found — /tm «Развитие» still missing" >&2
exit 1
