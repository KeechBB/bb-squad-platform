#!/usr/bin/env bash
# Инкрементальный прогон тимкилов panelka (логи TR/PB1 → disk cache).
set -uo pipefail
ROOT="${BB_PLATFORM_ROOT:-/var/www/bb-squad-platform}"
cd "$ROOT"
PY="${ROOT}/scripts/.venv-collector/bin/python"
if [[ ! -x "$PY" ]]; then PY=python3; fi
LOG=/var/log/bb-panelka-teamkills.log
mkdir -p "$(dirname "$LOG")"
echo "=== $(date '+%F %T %Z') warm_panelka_teamkills ===" >>"$LOG"
set +e
"$PY" scripts/build_panelka_teamkills.py --since 2026-11-01 --incremental >>"$LOG" 2>&1
ec=$?
set -e
echo "exit=$ec" >>"$LOG"
exit "$ec"
