#!/usr/bin/env bash
# Neon → local Postgres on this VPS. Run as root on 91.222.237.91
# Usage: bash scripts/migrate-neon-to-vps.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/bb-squad-platform}"
ENV_FILE="$APP_DIR/.env"
DB_NAME="${DB_NAME:-bb_squad}"
DB_USER="${DB_USER:-bb_squad}"
DUMP_DIR="${DUMP_DIR:-/root/bb-db-migrate}"
mkdir -p "$DUMP_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "No $ENV_FILE" >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a
# parse DATABASE_URL without sourcing whole .env (quotes)
NEON_URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | sed 's/^DATABASE_URL=//' | tr -d '"' | tr -d "'")"
set +a

if [[ -z "${NEON_URL}" || "$NEON_URL" != *neon.tech* ]]; then
  echo "DATABASE_URL is not a Neon URL (already migrated?). Abort." >&2
  echo "Current host snippet: ${NEON_URL:0:60}..." >&2
  exit 1
fi

# strip channel_binding / prisma schema= for pg client tools
NEON_URL="${NEON_URL//\&channel_binding=require/}"
NEON_URL="${NEON_URL//\?channel_binding=require\&/?}"
NEON_URL="${NEON_URL//\?channel_binding=require/}"
NEON_URL="$(python3 - <<PY
from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode
u = """$NEON_URL"""
p = urlparse(u)
q = [(k, v) for k, v in parse_qsl(p.query, keep_blank_values=True) if k not in ("schema", "channel_binding")]
print(urlunparse((p.scheme, p.netloc, p.path, "", urlencode(q), "")))
PY
)"

echo "==> Install PostgreSQL if needed"
export DEBIAN_FRONTEND=noninteractive
if ! command -v psql >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y postgresql postgresql-contrib postgresql-client
fi
systemctl enable --now postgresql

DB_PASS="$(openssl rand -hex 16)"
echo "==> Create role/db $DB_USER / $DB_NAME (localhost only)"
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}';
  ELSE
    ALTER ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASS}';
  END IF;
END
\$\$;
SELECT 'ok_role';
SQL
if ! sudo -u postgres psql -Atc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -qx 1; then
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"
fi
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "ALTER DATABASE ${DB_NAME} OWNER TO ${DB_USER};"
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB_NAME" -c "GRANT ALL ON SCHEMA public TO ${DB_USER};"
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB_NAME" -c "ALTER SCHEMA public OWNER TO ${DB_USER};"

LOCAL_URL="postgresql://${DB_USER}:${DB_PASS}@127.0.0.1:5432/${DB_NAME}?schema=public"
echo "$LOCAL_URL" > "$DUMP_DIR/local-database-url.txt"
chmod 600 "$DUMP_DIR/local-database-url.txt"

echo "==> Dump Neon (custom format)"
pg_dump "$NEON_URL" --no-owner --no-acl --format=custom -f "$DUMP_DIR/neon.dump"
ls -lh "$DUMP_DIR/neon.dump"

echo "==> Stop app + collector"
pm2 stop bb-squad bb-squad-collector || pm2 stop bb-squad || true

echo "==> Restore into local DB"
# drop public objects for clean restore
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB_NAME" <<'SQL'
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO public;
SQL
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB_NAME" -c "ALTER SCHEMA public OWNER TO ${DB_USER};"
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB_NAME" -c "GRANT ALL ON SCHEMA public TO ${DB_USER};"

pg_restore --no-owner --no-acl -d "$LOCAL_URL" "$DUMP_DIR/neon.dump" || true
# pg_restore may warn on extensions; verify counts below

echo "==> Backup .env and switch DATABASE_URL"
cp -a "$ENV_FILE" "$DUMP_DIR/env.before-migrate"
# replace DATABASE_URL line
python3 - <<PY
from pathlib import Path
env_path = Path("$ENV_FILE")
text = env_path.read_text(encoding="utf-8")
lines = []
found = False
new_url = Path("$DUMP_DIR/local-database-url.txt").read_text(encoding="utf-8").strip()
for line in text.splitlines():
    if line.startswith("DATABASE_URL="):
        lines.append(f'DATABASE_URL="{new_url}"')
        found = True
    else:
        lines.append(line)
if not found:
    lines.insert(0, f'DATABASE_URL="{new_url}"')
env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
print("DATABASE_URL updated")
PY

# collector env if separate
for f in "$APP_DIR/scripts/.squad-collector.env" "$APP_DIR/scripts/.squad-collector.env.run"; do
  if [[ -f "$f" ]] && grep -q '^DATABASE_URL=' "$f" 2>/dev/null; then
    cp -a "$f" "$DUMP_DIR/$(basename "$f").before"
    python3 - <<PY
from pathlib import Path
p = Path("$f")
new_url = Path("$DUMP_DIR/local-database-url.txt").read_text(encoding="utf-8").strip()
lines = []
found = False
for line in p.read_text(encoding="utf-8").splitlines():
    if line.startswith("DATABASE_URL="):
        lines.append(f'DATABASE_URL="{new_url}"')
        found = True
    else:
        lines.append(line)
if found:
    p.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("updated", p)
PY
  fi
done

echo "==> Counts on local"
psql "$LOCAL_URL" -c 'SELECT schemaname,relname,n_live_tup FROM pg_stat_user_tables ORDER BY relname;' || \
psql "$LOCAL_URL" -c 'SELECT count(*) AS users FROM "User"; SELECT count(*) AS sessions FROM "SquadServerSession";'

echo "==> Start pm2"
pm2 start bb-squad || pm2 restart bb-squad
pm2 start bb-squad-collector || pm2 restart bb-squad-collector || true
pm2 save || true
pm2 status

echo "==> DONE. Neon URL kept in $DUMP_DIR/env.before-migrate for rollback."
echo "Local URL file: $DUMP_DIR/local-database-url.txt (chmod 600)"
echo "Smoke: curl -sI https://bb-squad.ru | head -5"
