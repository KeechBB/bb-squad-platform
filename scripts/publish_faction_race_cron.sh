#!/usr/bin/env bash
# Тик гонки фракций (окна, письма, grace→force). Ставить в crontab каждые 5 мин.
set -euo pipefail
URL="${FACTION_RACE_CRON_URL:-http://127.0.0.1:3000/api/cron/faction-race}"
curl -fsS -X POST "$URL" \
  -H "x-bb-faction-race-cron: 1" \
  -H "content-type: application/json" \
  -d '{}' \
  >/dev/null
