#!/usr/bin/env bash
# Daily pg_dump of local bb_squad DB. Cron example:
#   15 3 * * * root /var/www/bb-squad-platform/scripts/backup-db.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/bb-squad-platform}"
ENV_FILE="$APP_DIR/.env"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/bb-squad}"
KEEP_DAYS="${KEEP_DAYS:-14}"

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

STAMP="$(date -u +%Y%m%d_%H%M%S)"
OUT="$BACKUP_ROOT/bb_squad_${STAMP}.dump"
pg_dump "$URL" --no-owner --no-acl --format=custom -f "$OUT"
chmod 600 "$OUT"
ls -lh "$OUT"

# prune
find "$BACKUP_ROOT" -type f -name 'bb_squad_*.dump' -mtime +"$KEEP_DAYS" -delete || true
echo "backup ok"
