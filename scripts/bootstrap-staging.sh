#!/usr/bin/env bash
# Одноразовая установка staging на VPS (root).
# Запуск на сервере:
#   cd /var/www/bb-squad-platform && git pull && bash scripts/bootstrap-staging.sh
set -euo pipefail

PROD_ROOT="${PROD_ROOT:-/var/www/bb-squad-platform}"
STAGING_ROOT="${STAGING_ROOT:-/var/www/bb-squad-platform-staging}"
REPO_URL="${REPO_URL:-https://github.com/KeechBB/bb-squad-platform.git}"
BRANCH="${STAGING_BRANCH:-staging}"
DB_NAME="${STAGING_DB_NAME:-bb_squad_staging}"
PORT="${PORT:-3001}"

if [[ ! -f "$PROD_ROOT/.env" ]]; then
  echo "prod .env not found at $PROD_ROOT/.env" >&2
  exit 1
fi

echo "==> create Postgres DB $DB_NAME (if missing)"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 \
  || sudo -u postgres createdb -O bb_squad "$DB_NAME"

echo "==> read prod DATABASE_URL"
set -a
# shellcheck disable=SC1090
source <(grep -E '^(DATABASE_URL)=' "$PROD_ROOT/.env" | sed 's/\r$//')
set +a
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL missing in prod .env" >&2
  exit 1
fi

# Prisma URL may contain ?schema=public — pg_dump/psql reject that.
eval "$(DATABASE_URL="$DATABASE_URL" STAGING_DB_NAME="$DB_NAME" python3 - <<'PY'
import os, re, shlex
u = os.environ["DATABASE_URL"]
name = os.environ["STAGING_DB_NAME"]
# strip prisma query for libpq tools
base = u.split("?", 1)[0]
m = re.match(r"^(postgresql(?:\+\w+)?://[^/]+/)([^/\s]+)$", base)
if not m:
    raise SystemExit("cannot parse DATABASE_URL")
prod_libpq = base
staging_libpq = m.group(1) + name
# keep prisma-style query on staging app URL
q = ""
if "?" in u:
    q = "?" + u.split("?", 1)[1]
staging_app = staging_libpq + q
print("PROD_LIBPQ_URL=" + shlex.quote(prod_libpq))
print("STAGING_LIBPQ_URL=" + shlex.quote(staging_libpq))
print("STAGING_DATABASE_URL=" + shlex.quote(staging_app))
PY
)"

echo "==> pg_dump prod → restore staging"
TMP_DUMP="$(mktemp /tmp/bb-staging-XXXXXX.sql)"
pg_dump "$PROD_LIBPQ_URL" --no-owner --no-acl > "$TMP_DUMP"
psql "$STAGING_LIBPQ_URL" -v ON_ERROR_STOP=1 -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO bb_squad; GRANT ALL ON SCHEMA public TO public;"
psql "$STAGING_LIBPQ_URL" -v ON_ERROR_STOP=1 -f "$TMP_DUMP"
rm -f "$TMP_DUMP"

echo "==> clone/checkout staging code → $STAGING_ROOT"
if [[ ! -d "$STAGING_ROOT/.git" ]]; then
  git clone "$REPO_URL" "$STAGING_ROOT"
fi
cd "$STAGING_ROOT"
git fetch origin
if git show-ref --verify --quiet "refs/remotes/origin/$BRANCH"; then
  git checkout "$BRANCH"
  git pull --ff-only origin "$BRANCH"
elif git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  git checkout "$BRANCH"
else
  echo "==> branch $BRANCH missing on remote — create from main"
  git checkout main
  git pull --ff-only origin main
  git checkout -B "$BRANCH"
  git push -u origin "$BRANCH" || true
fi

echo "==> write staging .env from prod (override URL/port)"
cp -a "$PROD_ROOT/.env" "$STAGING_ROOT/.env"
DATABASE_URL="$STAGING_DATABASE_URL" NEXTAUTH_URL="https://staging.bb-squad.ru" PORT="$PORT" \
python3 - <<'PY'
from pathlib import Path
import os
p = Path(".env")
text = p.read_text(encoding="utf-8")
repl = {
    "DATABASE_URL": os.environ["DATABASE_URL"],
    "NEXTAUTH_URL": os.environ["NEXTAUTH_URL"],
    "PORT": os.environ["PORT"],
}
lines = []
seen = set()
for line in text.splitlines():
    if not line or line.lstrip().startswith("#") or "=" not in line:
        lines.append(line)
        continue
    key = line.split("=", 1)[0].strip()
    if key in repl:
        lines.append(f'{key}="{repl[key]}"')
        seen.add(key)
    else:
        lines.append(line)
for key, val in repl.items():
    if key not in seen:
        lines.append(f'{key}="{val}"')
p.write_text("\n".join(lines) + "\n", encoding="utf-8")
print("wrote .env overrides:", ", ".join(repl))
PY

echo "==> nginx site"
install -m 644 "$STAGING_ROOT/deploy/nginx-bb-squad-staging.conf" /etc/nginx/sites-available/bb-squad-staging
ln -sfn /etc/nginx/sites-available/bb-squad-staging /etc/nginx/sites-enabled/bb-squad-staging
nginx -t
systemctl reload nginx

echo "==> certbot HTTPS for staging.bb-squad.ru"
if certbot certificates 2>/dev/null | grep -q 'staging.bb-squad.ru'; then
  echo "==> cert already present"
else
  certbot --nginx -d staging.bb-squad.ru --non-interactive --agree-tos --register-unsafely-without-email \
    || certbot --nginx -d staging.bb-squad.ru --non-interactive --agree-tos \
    || echo "WARN: certbot failed — check DNS and rerun: certbot --nginx -d staging.bb-squad.ru"
fi

echo "==> first staging deploy (build + pm2)"
bash "$STAGING_ROOT/scripts/deploy-staging.sh"

echo "==> DONE"
echo "Open: https://staging.bb-squad.ru"
echo "Refresh DB later: bash $STAGING_ROOT/scripts/refresh-staging-db.sh"
echo "If Steam login fails: Steam API Domain = bb-squad.ru usually covers subdomain; else add staging.bb-squad.ru"
