#!/usr/bin/env bash
# Daily inactive BB clan alerts (MSK). Cron: TZ=Europe/Moscow
# Usage: bash inactive_clan_alert.sh [--dry]
set -euo pipefail
ROOT="${BB_PLATFORM_ROOT:-/var/www/bb-squad-platform}"
cd "$ROOT"
URL="${INACTIVE_ALERT_URL:-http://127.0.0.1:3000/api/cron/inactive-clan-alert}"
if [[ "${1:-}" == "--dry" || "${1:-}" == "dry" ]]; then
  URL="${URL}?dry=1"
fi
HDR=(-H "x-bb-inactive-cron: 1" -H "Host: 127.0.0.1:3000")
if [[ -n "${CRON_SECRET:-}" ]]; then
  HDR+=(-H "x-cron-secret: ${CRON_SECRET}")
elif [[ -f "$ROOT/.env" ]]; then
  SECRET="$(grep -E '^CRON_SECRET=' "$ROOT/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true)"
  if [[ -n "${SECRET:-}" ]]; then
    HDR+=(-H "x-cron-secret: ${SECRET}")
  fi
fi
curl -sS --max-time 300 "${HDR[@]}" -X POST "$URL" || curl -sS --max-time 300 "${HDR[@]}" "$URL" || true
echo
