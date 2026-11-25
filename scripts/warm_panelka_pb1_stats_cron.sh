#!/usr/bin/env bash
# Precompute admin PB1 player-card stats → data/cache/panelka-pb1-stats/
set -euo pipefail
URL="${PANELKA_PB1_WARM_URL:-http://127.0.0.1:3000/api/cron/panelka-pb1-stats-warm}"
curl -fsS -X POST "$URL" \
  -H "x-bb-panelka-pb1-warm: 1" \
  -H "content-type: application/json" \
  -d '{"limit":50,"skipLiveIp":true}' \
  || true
