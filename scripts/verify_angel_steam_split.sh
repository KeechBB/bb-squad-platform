#!/usr/bin/env bash
# Постматчевая / cron сверка angel BB vs Алан vs ALPHA ·8062 по Steam.
# --fix также чинит табло: [BB] angel / 〔 A 〕 angel на своих сторонах.
set -uo pipefail
ROOT="${BB_PLATFORM_ROOT:-/var/www/bb-squad-platform}"
cd "$ROOT"
export NODE_OPTIONS="${NODE_OPTIONS:-} --max-old-space-size=3072"
LOG=/var/log/bb-angel-steam-verify.log
mkdir -p "$(dirname "$LOG")"
echo "=== $(date '+%F %T %Z') verify_angel_steam_split $* ===" >>"$LOG"
set +e
npx --yes tsx scripts/verify_angel_steam_split.ts "$@" >>"$LOG" 2>&1
ec=$?
set -e
echo "exit=$ec" >>"$LOG"
exit "$ec"
