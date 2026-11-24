#!/usr/bin/env bash
# Итог ставок фракций после 01:00 МСК. Crontab: 2 22 * * * (01:02 МСК = 22:02 UTC).
set -euo pipefail
URL="${NIGHT_BETS_CRON_URL:-http://127.0.0.1:3000/api/cron/night-bets-settle}"
curl -fsS -X POST "$URL" \
  -H "x-bb-night-bets-cron: 1" \
  -H "content-type: application/json" \
  -d '{}' \
  >/dev/null
