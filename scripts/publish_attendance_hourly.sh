#!/usr/bin/env bash
# Publish public attendance snapshot (MSK :00). Cron: TZ=Europe/Moscow 0 * * * *
set -euo pipefail
ROOT="${BB_PLATFORM_ROOT:-/var/www/bb-squad-platform}"
cd "$ROOT"
URL="${ATTENDANCE_PUBLISH_URL:-http://127.0.0.1:3000/api/cron/attendance-publish}"
HDR=()
if [[ -n "${CRON_SECRET:-}" ]]; then
  HDR=(-H "x-cron-secret: ${CRON_SECRET}")
elif [[ -f "$ROOT/.env" ]]; then
  # shellcheck disable=SC1091
  set -a
  # load only CRON_SECRET if present
  SECRET="$(grep -E '^CRON_SECRET=' "$ROOT/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
  set +a
  if [[ -n "${SECRET:-}" ]]; then
    HDR=(-H "x-cron-secret: ${SECRET}")
  fi
fi
curl -sS --max-time 120 "${HDR[@]}" -X POST "$URL" || curl -sS --max-time 120 "${HDR[@]}" "$URL"
echo
