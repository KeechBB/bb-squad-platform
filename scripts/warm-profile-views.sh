#!/usr/bin/env bash
# Переписать несколько файлов профиля вне процесса сайта.
set -euo pipefail
ROOT="${BB_PLATFORM_ROOT:-/var/www/bb-squad-platform}"
cd "$ROOT"
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi
npx --yes tsx scripts/warm-profile-views.ts "${1:-3}"
