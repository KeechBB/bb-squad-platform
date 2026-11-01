#!/usr/bin/env bash
set -euo pipefail
ROOT="${BB_PLATFORM_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$ROOT"
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi
exec python3 scripts/smoke_tournament_hub.py "$@"
