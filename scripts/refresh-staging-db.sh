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

eval "$(DATABASE_URL="$DATABASE_URL" STAGING_DB_NAME="$DB_NAME" python3 - <<'PY'
import os, re, shlex
u = os.environ["DATABASE_URL"]
name = os.environ["STAGING_DB_NAME"]
base = u.split("?", 1)[0]
m = re.match(r"^(postgresql(?:\+\w+)?://[^/]+/)([^/\s]+)$", base)
if not m:
    raise SystemExit("cannot parse DATABASE_URL")
print("PROD_LIBPQ_URL=" + shlex.quote(base))
print("STAGING_LIBPQ_URL=" + shlex.quote(m.group(1) + name))
PY
)"

echo "==> dump prod → $DB_NAME"
TMP_DUMP="$(mktemp /tmp/bb-staging-XXXXXX.sql)"
pg_dump "$PROD_LIBPQ_URL" --no-owner --no-acl > "$TMP_DUMP"
psql "$STAGING_LIBPQ_URL" -v ON_ERROR_STOP=1 -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO bb_squad; GRANT ALL ON SCHEMA public TO public;"
psql "$STAGING_LIBPQ_URL" -v ON_ERROR_STOP=1 -f "$TMP_DUMP"
rm -f "$TMP_DUMP"

if [[ -f "$STAGING_ROOT/.env" ]]; then
  echo "==> prisma db push on staging"
  (cd "$STAGING_ROOT" && npx prisma db push)
fi

echo "==> OK staging DB refreshed $(date -Is)"
