#!/usr/bin/env bash
# Daily pg_dump of local bb_squad DB.
# Cron (Moscow midnight): see /etc/cron.d/bb-squad-db
# Keeps the newest KEEP_COUNT dumps; deletes older ones.
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/bb-squad-platform}"
ENV_FILE="$APP_DIR/.env"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/bb-squad}"
KEEP_COUNT="${KEEP_COUNT:-5}"

mkdir -p "$BACKUP_ROOT"
chmod 700 "$BACKUP_ROOT"

URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | sed 's/^DATABASE_URL=//' | tr -d '"' | tr -d "'")"
if [[ -z "$URL" ]]; then
  echo "No DATABASE_URL in $ENV_FILE" >&2
  exit 1
fi

# Prisma uses ?schema=public — pg_dump rejects it
URL="$(python3 - <<PY
from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode
u = """$URL"""
p = urlparse(u)
q = [(k, v) for k, v in parse_qsl(p.query, keep_blank_values=True) if k != "schema"]
print(urlunparse((p.scheme, p.netloc, p.path, "", urlencode(q), "")))
PY
)"

STAMP="$(TZ=Europe/Moscow date +%Y%m%d_%H%M%S)"
OUT="$BACKUP_ROOT/bb_squad_${STAMP}.dump"
pg_dump "$URL" --no-owner --no-acl --format=custom -f "$OUT"
chmod 600 "$OUT"
ls -lh "$OUT"

# Keep only the newest KEEP_COUNT dumps (by mtime)
mapfile -t ALL < <(find "$BACKUP_ROOT" -maxdepth 1 -type f -name 'bb_squad_*.dump' -printf '%T@ %p\n' | sort -nr | awk '{print $2}')
TOTAL=${#ALL[@]}
if (( TOTAL > KEEP_COUNT )); then
  for ((i=KEEP_COUNT; i<TOTAL; i++)); do
    rm -f -- "${ALL[$i]}"
    echo "removed old ${ALL[$i]}"
  done
fi

echo "backup ok (kept up to $KEEP_COUNT)"
ls -lh "$BACKUP_ROOT"/bb_squad_*.dump 2>/dev/null || true
