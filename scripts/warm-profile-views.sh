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
# Site copies keep 4. This job must not open a pool sized for every CPU.
export BB_PRISMA_CONNECTION_LIMIT=1
export BB_PRISMA_POOL_TIMEOUT=2
export BB_PRISMA_APP_NAME=bb-warm
npx --yes tsx scripts/warm-profile-views.ts "${1:-3}"
