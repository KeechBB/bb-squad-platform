#!/usr/bin/env bash
# ВЫКЛ 07.11.2026 — подсчёт / автофит тиров больше не нужен (канон Alex).
# Cron может ещё дергать скрипт — сразу выходим, ничего не пишем в tiers.
set -euo pipefail
echo "$(date -Is) tier autonomy DISABLED — skip"
exit 0
