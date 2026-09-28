#!/usr/bin/env bash
# Полный бэкап платформы BB для отката «как было»:
#   - Postgres (все таблицы/данные)
#   - код сайта + .env + аплоады (без node_modules / .next)
#   - nginx (сайты bb-squad*), pm2 dump, cron бэкапов
#
# Результат: /var/backups/bb-squad-full/bb-squad-full_YYYYMMDD_HHMMSS.tar.gz
# Хранит KEEP_COUNT последних архивов.
#
# Cron (Москва 00:15): см. install внизу файла / docs/HOSTING.md
# Восстановление: docs/RECOVERY.md § Полный бэкап
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/bb-squad-platform}"
ENV_FILE="$APP_DIR/.env"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/bb-squad-full}"
KEEP_COUNT="${KEEP_COUNT:-5}"
STAMP="$(TZ=Europe/Moscow date +%Y%m%d_%H%M%S)"
WORK="$(mktemp -d /tmp/bb-full-backup.XXXXXX)"
ARCHIVE="$BACKUP_ROOT/bb-squad-full_${STAMP}.tar.gz"

cleanup() { rm -rf -- "$WORK"; }
trap cleanup EXIT

mkdir -p "$BACKUP_ROOT" "$WORK"/{db,app,meta/nginx,meta/pm2,meta/cron}
chmod 700 "$BACKUP_ROOT"

echo "==> full backup $STAMP"

# --- 1) Database ---
if [[ ! -f "$ENV_FILE" ]]; then
  echo "No $ENV_FILE" >&2
  exit 1
fi
URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | sed 's/^DATABASE_URL=//' | tr -d '"' | tr -d "'")"
URL="$(python3 - <<PY
from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode
u = """$URL"""
p = urlparse(u)
q = [(k, v) for k, v in parse_qsl(p.query, keep_blank_values=True) if k != "schema"]
print(urlunparse((p.scheme, p.netloc, p.path, "", urlencode(q), "")))
PY
)"
pg_dump "$URL" --no-owner --no-acl --format=custom -f "$WORK/db/bb_squad.dump"
chmod 600 "$WORK/db/bb_squad.dump"
echo "  db dump ok ($(du -h "$WORK/db/bb_squad.dump" | awk '{print $1}'))"

# --- 2) App tree (code + env + uploads; skip rebuildable junk) ---
rsync -a \
  --exclude='node_modules/' \
  --exclude='.next/' \
  --exclude='.git/' \
  --exclude='scripts/__pycache__/' \
  --exclude='scripts/_tmp_*' \
  --exclude='scripts/_collector_*' \
  --exclude='scripts/_watchdog*' \
  --exclude='*.log' \
  "$APP_DIR/" "$WORK/app/"
# гарантируем .env в архиве (rsync уже скопирует, если есть)
if [[ -f "$ENV_FILE" ]]; then
  cp -a "$ENV_FILE" "$WORK/app/.env"
  chmod 600 "$WORK/app/.env"
fi
echo "  app tree ok ($(du -sh "$WORK/app" | awk '{print $1}'))"

# --- 3) nginx ---
shopt -s nullglob
for f in /etc/nginx/sites-enabled/*bb-squad* /etc/nginx/sites-available/*bb-squad* \
         /etc/nginx/sites-enabled/*bb_squad* /etc/nginx/conf.d/*bb-squad*; do
  [[ -e "$f" ]] || continue
  cp -a "$f" "$WORK/meta/nginx/" 2>/dev/null || true
done
if [[ -f /etc/nginx/nginx.conf ]]; then
  cp -a /etc/nginx/nginx.conf "$WORK/meta/nginx/nginx.conf.root" 2>/dev/null || true
fi
echo "  nginx copies: $(ls -1 "$WORK/meta/nginx" 2>/dev/null | wc -l)"

# --- 4) pm2 ---
if command -v pm2 >/dev/null 2>&1; then
  pm2 save >/dev/null 2>&1 || true
  [[ -f /root/.pm2/dump.pm2 ]] && cp -a /root/.pm2/dump.pm2 "$WORK/meta/pm2/" || true
  pm2 jlist > "$WORK/meta/pm2/jlist.json" 2>/dev/null || true
fi

# --- 5) cron ---
[[ -f /etc/cron.d/bb-squad-db ]] && cp -a /etc/cron.d/bb-squad-db "$WORK/meta/cron/" || true
[[ -f /etc/cron.d/bb-squad-full ]] && cp -a /etc/cron.d/bb-squad-full "$WORK/meta/cron/" || true
crontab -l > "$WORK/meta/cron/root.crontab" 2>/dev/null || true

# --- 6) manifest ---
{
  echo "bb-squad FULL backup"
  echo "stamp_msk=$STAMP"
  echo "host=$(hostname -f 2>/dev/null || hostname)"
  echo "created=$(date -Is)"
  echo "app_dir=$APP_DIR"
  echo "git_head=$(git -C "$APP_DIR" rev-parse HEAD 2>/dev/null || echo unknown)"
  echo "git_describe=$(git -C "$APP_DIR" describe --always --dirty 2>/dev/null || echo unknown)"
  echo "contents=db.dump + app(code,env,uploads) + nginx + pm2 + cron"
  echo "note=node_modules/.next NOT included — after restore: npm ci && npx prisma generate && npm run build && pm2 restart"
} > "$WORK/MANIFEST.txt"

# --- pack ---
tar -C "$WORK" -czf "$ARCHIVE" .
chmod 600 "$ARCHIVE"
echo "==> wrote $ARCHIVE ($(du -h "$ARCHIVE" | awk '{print $1}'))"

# --- rotate ---
mapfile -t ALL < <(find "$BACKUP_ROOT" -maxdepth 1 -type f -name 'bb-squad-full_*.tar.gz' -printf '%T@ %p\n' | sort -nr | awk '{print $2}')
TOTAL=${#ALL[@]}
if (( TOTAL > KEEP_COUNT )); then
  for ((i=KEEP_COUNT; i<TOTAL; i++)); do
    rm -f -- "${ALL[$i]}"
    echo "removed old ${ALL[$i]}"
  done
fi

echo "==> keep $KEEP_COUNT newest:"
ls -lht "$BACKUP_ROOT"/bb-squad-full_*.tar.gz 2>/dev/null | head -n "$KEEP_COUNT" || true
echo "full backup ok"

# Установка cron (один раз, от root):
#   chmod +x /var/www/bb-squad-platform/scripts/backup-full.sh
#   cat >/etc/cron.d/bb-squad-full <<'EOF'
#   CRON_TZ=Europe/Moscow
#   15 0 * * * root /var/www/bb-squad-platform/scripts/backup-full.sh >> /var/log/bb-squad-full-backup.log 2>&1
#   EOF
#   chmod 644 /etc/cron.d/bb-squad-full
