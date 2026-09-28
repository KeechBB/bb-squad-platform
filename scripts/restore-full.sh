#!/usr/bin/env bash
# Восстановление из полного бэкапа bb-squad-full_*.tar.gz
# USAGE: bash scripts/restore-full.sh /var/backups/bb-squad-full/bb-squad-full_YYYYMMDD_HHMMSS.tar.gz
# ВНИМАНИЕ: перезапишет /var/www/bb-squad-platform (кроме node_modules/.next — их пересоберём)
#           и БД bb_squad.
set -euo pipefail

ARCHIVE="${1:-}"
APP_DIR="${APP_DIR:-/var/www/bb-squad-platform}"
if [[ -z "$ARCHIVE" || ! -f "$ARCHIVE" ]]; then
  echo "Usage: $0 /path/to/bb-squad-full_*.tar.gz" >&2
  exit 1
fi

WORK="$(mktemp -d /tmp/bb-full-restore.XXXXXX)"
cleanup() { rm -rf -- "$WORK"; }
trap cleanup EXIT

echo "==> extract $ARCHIVE"
tar -C "$WORK" -xzf "$ARCHIVE"
[[ -f "$WORK/MANIFEST.txt" ]] && cat "$WORK/MANIFEST.txt"

echo "==> stop app"
pm2 stop bb-squad bb-squad-collector 2>/dev/null || true

echo "==> restore app files → $APP_DIR"
mkdir -p "$APP_DIR"
rsync -a --delete \
  --exclude='node_modules/' \
  --exclude='.next/' \
  "$WORK/app/" "$APP_DIR/"
chmod 600 "$APP_DIR/.env" 2>/dev/null || true

echo "==> restore database"
URL="$(grep -E '^DATABASE_URL=' "$APP_DIR/.env" | head -1 | sed 's/^DATABASE_URL=//' | tr -d '"' | tr -d "'")"
URL="$(python3 - <<PY
from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode
u = """$URL"""
p = urlparse(u)
q = [(k, v) for k, v in parse_qsl(p.query, keep_blank_values=True) if k != "schema"]
print(urlunparse((p.scheme, p.netloc, p.path, "", urlencode(q), "")))
PY
)"
# drop+recreate public schema objects via pg_restore --clean
pg_restore --clean --if-exists --no-owner --no-acl -d "$URL" "$WORK/db/bb_squad.dump"

echo "==> npm ci + build"
cd "$APP_DIR"
npm ci || npm install
npx prisma generate
npx prisma db push
npm run build

echo "==> restore nginx (copy only — review before reload)"
if [[ -d "$WORK/meta/nginx" ]]; then
  mkdir -p /root/bb-restore-nginx-"$(date +%Y%m%d)"
  cp -a "$WORK/meta/nginx/." /root/bb-restore-nginx-"$(date +%Y%m%d)/"
  echo "  nginx files saved to /root/bb-restore-nginx-* — copy to /etc/nginx/ manually if needed"
fi

echo "==> pm2 restart"
pm2 start bb-squad || pm2 restart bb-squad
pm2 start bb-squad-collector || pm2 restart bb-squad-collector || true
pm2 save || true

echo "==> restore OK"
pm2 status
