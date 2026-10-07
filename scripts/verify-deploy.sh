#!/usr/bin/env bash
# Проверка: локальный/ожидаемый git SHA реально на VPS + живые эндпоинты фич.
# Локально:  bash scripts/verify-deploy.sh
# На VPS:    bash scripts/verify-deploy.sh --local
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VPS_HOST="${BB_VPS_HOST:-91.222.237.91}"
VPS_USER="${BB_VPS_USER:-root}"
VPS_KEY="${BB_VPS_KEY:-$HOME/.ssh/bb_vps_ed25519}"
PLATFORM_DIR="${BB_PLATFORM_DIR:-/var/www/bb-squad-platform}"
KV_DIR="${BB_KV_DIR:-/var/www/blackberry-kv}"
SITE="${BB_SITE_URL:-https://bb-squad.ru}"
MODE="remote"
EXPECT_SHA=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --local) MODE="local"; shift ;;
    --sha)
      EXPECT_SHA="${2:-}"
      shift 2
      ;;
    --host)
      VPS_HOST="${2:-}"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 [--local] [--sha <commit>] [--host <ip>]"
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      exit 2
      ;;
  esac
done

if [[ -z "$EXPECT_SHA" && -d "$ROOT/.git" ]]; then
  EXPECT_SHA="$(git -C "$ROOT" rev-parse HEAD)"
fi

PASS=0
FAIL=0
WARN=0

ok() { echo "  OK  $*"; PASS=$((PASS + 1)); }
bad() { echo "  FAIL $*"; FAIL=$((FAIL + 1)); }
warn() { echo "  WARN $*"; WARN=$((WARN + 1)); }

ssh_cmd() {
  if [[ "$MODE" == "local" ]]; then
    bash -lc "$*"
  else
    local key_args=()
    if [[ -f "$VPS_KEY" ]]; then
      key_args=(-i "$VPS_KEY")
    fi
    ssh -o ConnectTimeout=15 -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
      "${key_args[@]}" "${VPS_USER}@${VPS_HOST}" "$*"
  fi
}

echo "==> verify-deploy mode=$MODE host=$VPS_HOST expect=${EXPECT_SHA:0:12}"

echo "-- SSH / git"
if OUT="$(ssh_cmd "echo SSH_OK; hostname; cd $PLATFORM_DIR && git rev-parse HEAD && git rev-parse --abbrev-ref HEAD" 2>&1)"; then
  if echo "$OUT" | grep -q SSH_OK; then
    ok "ssh reachable"
  else
    bad "ssh no SSH_OK marker"
  fi
  REMOTE_SHA="$(echo "$OUT" | tail -n 2 | head -n 1 | tr -d '\r')"
  REMOTE_BR="$(echo "$OUT" | tail -n 1 | tr -d '\r')"
  echo "  remote: $REMOTE_BR @ ${REMOTE_SHA:0:12}"
  if [[ -n "$EXPECT_SHA" ]]; then
    if [[ "$REMOTE_SHA" == "$EXPECT_SHA" ]] || [[ "$REMOTE_SHA" == "$EXPECT_SHA"* ]] || [[ "$EXPECT_SHA" == "$REMOTE_SHA"* ]]; then
      ok "platform HEAD matches expect"
    elif echo "$REMOTE_SHA" | grep -qiE '^[0-9a-f]{7,40}$'; then
      # allow remote ahead of local expect if expect is ancestor — check via remote
      if ssh_cmd "cd $PLATFORM_DIR && git merge-base --is-ancestor ${EXPECT_SHA:0:12} HEAD" 2>/dev/null; then
        ok "platform HEAD contains expect (${EXPECT_SHA:0:12})"
      else
        bad "platform HEAD ${REMOTE_SHA:0:12} missing expect ${EXPECT_SHA:0:12}"
      fi
    else
      bad "could not parse remote sha: $REMOTE_SHA"
    fi
  fi
else
  bad "ssh failed: $OUT"
fi

echo "-- PM2"
if PM2="$(ssh_cmd "pm2 jlist" 2>/dev/null)"; then
  if echo "$PM2" | grep -q '"name":"bb-squad"'; then
    if echo "$PM2" | grep -q '"name":"bb-squad".*"status":"online"\|"status":"online".*"name":"bb-squad"'; then
      ok "pm2 bb-squad online"
    else
      # softer parse
      STATUS="$(echo "$PM2" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(next((p.get("pm2_env",{}).get("status") for p in d if p.get("name")=="bb-squad"),"missing"))' 2>/dev/null || echo unknown)"
      if [[ "$STATUS" == "online" ]]; then
        ok "pm2 bb-squad online"
      else
        bad "pm2 bb-squad status=$STATUS"
      fi
    fi
  else
    bad "pm2 bb-squad not found"
  fi
else
  warn "pm2 jlist unavailable"
fi

echo "-- HTTP feature probes ($SITE)"
probe() {
  local name="$1" url="$2" needle="$3"
  local code body
  body="$(mktemp)"
  code="$(curl -sS -o "$body" -w "%{http_code}" -L --max-time 25 "$url" || echo 000)"
  if [[ "$code" != "200" ]]; then
    bad "$name HTTP $code ($url)"
    rm -f "$body"
    return
  fi
  if [[ -n "$needle" ]] && ! grep -qE "$needle" "$body"; then
    bad "$name 200 but missing /$needle/ ($url)"
  else
    ok "$name HTTP 200"
  fi
  rm -f "$body"
}

# Home
probe "home" "$SITE/" "bb-squad|BlackBerry|html"

# Clan API: combat/hitmap fields from recent stats work
# Discover an external clan id if possible via clans list page HTML, else skip soft
CLANS_HTML="$(mktemp)"
CLANS_CODE="$(curl -sS -o "$CLANS_HTML" -w "%{http_code}" -L --max-time 25 "$SITE/clans" || echo 000)"
if [[ "$CLANS_CODE" == "200" ]]; then
  ok "clans page HTTP 200"
  CLAN_ID="$(grep -oE '/clans/[a-z0-9]{20,}' "$CLANS_HTML" | head -n 1 | sed 's#/clans/##' || true)"
  if [[ -n "$CLAN_ID" ]]; then
    probe "clan-stats" "$SITE/api/clans/$CLAN_ID/stats" '"ok":\s*true|"combat"|"hitmap"|"wins"'
  else
    warn "no clan id scraped from /clans — skip stats probe"
  fi
else
  bad "clans page HTTP $CLANS_CODE"
fi
rm -f "$CLANS_HTML"

# KV static (CW embed) — row tint CSS marker
probe "kv-static-css" "$SITE/kv-static/styles.css" "середины колонки|rgba\(52, 211, 153, 0\.38\)|tr\.win td:nth-child\(1\)::before"

# KV cache on disk (VPS)
if ssh_cmd "test -f $PLATFORM_DIR/data/kv-cache/styles.css && grep -q 'tr.win td:nth-child(1)::before\\|rgba(52, 211, 153, 0.38)' $PLATFORM_DIR/data/kv-cache/styles.css" 2>/dev/null; then
  ok "kv-cache styles has result fade"
else
  warn "kv-cache styles missing result fade (run sync_kv_cache after KV push)"
fi

# Feature commits presence (by message / file)
if ssh_cmd "test -f $PLATFORM_DIR/src/components/ClanAvgHitmap.tsx" 2>/dev/null; then
  ok "ClanAvgHitmap.tsx present on VPS"
else
  bad "ClanAvgHitmap.tsx missing on VPS"
fi
if ssh_cmd "grep -q 'purgeAutoDefaultSquads\\|isExternal' $PLATFORM_DIR/src/lib/squads.ts" 2>/dev/null; then
  ok "external squad purge in squads.ts"
else
  bad "squads.ts missing external purge"
fi

echo
echo "==> result: pass=$PASS fail=$FAIL warn=$WARN"
if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
exit 0
