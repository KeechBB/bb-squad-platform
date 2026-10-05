#!/usr/bin/env bash
# Обновить staging-БД свежим dump с прода (не трогает код).
# Запуск: bash /var/www/bb-squad-platform-staging/scripts/refresh-staging-db.sh
set -euo pipefail

PROD_ROOT="${PROD_ROOT:-/var/www/bb-squad-platform}"
STAGING_ROOT="${STAGING_ROOT:-/var/www/bb-squad-platform-staging}"
DB_NAME="${STAGING_DB_NAME:-bb_squad_staging}"

set -a
# shellcheck disable=SC1090
source <(grep -E '^(DATABASE_URL)=' "$PROD_ROOT/.env" | sed 's/\r$//')
set +a

STAGING_DATABASE_URL="$(STAGING_DB_NAME="$DB_NAME" DATABASE_URL="$DATABASE_URL" python3 - <<'PY'
import os, re
u = os.environ["DATABASE_URL"]
name = os.environ["STAGING_DB_NAME"]
m = re.match(r"^(postgresql(?:\+\w+)?://[^/]+/)([^?\s]+)(.*)$", u)
if not m:
    raise SystemExit("cannot parse DATABASE_URL")
print(m.group(1) + name + m.group(3))
PY
)"

echo "==> dump prod → $DB_NAME"
TMP_DUMP="$(mktemp /tmp/bb-staging-XXXXXX.sql)"
pg_dump "$DATABASE_URL" --no-owner --no-acl > "$TMP_DUMP"
psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO bb_squad; GRANT ALL ON SCHEMA public TO public;"
psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$TMP_DUMP"
rm -f "$TMP_DUMP"

if [[ -f "$STAGING_ROOT/.env" ]]; then
  echo "==> prisma db push on staging"
  (cd "$STAGING_ROOT" && npx prisma db push)
fi

echo "==> OK staging DB refreshed $(date -Is)"
