#!/bin/bash
# Sqstat overwrites Admins.cfg ~every 5m — restore panelka VIPs + cameras from JSON stores.
set -euo pipefail
ROOT=/var/www/bb-squad-platform
cd "$ROOT"
PY="$ROOT/scripts/.venv-collector/bin/python"
SCRIPT="$ROOT/scripts/panelka_rcon.py"
if [[ ! -x "$PY" ]]; then
  PY=python3
fi
"$PY" "$SCRIPT" cameras-heal
"$PY" "$SCRIPT" vips-heal
