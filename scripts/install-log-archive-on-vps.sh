#!/usr/bin/env bash
# Долговременный архив логов Squad (PB1, TR1…TR5) на plaza.
# PM2: bb-squad-siphon — раз в ~5 мин тянет ВСЕ backup'ы + live mirror.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPTS="$ROOT/scripts"
ENV_FILE="$SCRIPTS/.squad-collector.env"
VENV="$SCRIPTS/.venv-collector"
NAME="bb-squad-siphon"
ARCHIVE_ROOT="${BB_LOG_ARCHIVE_ROOT:-/var/www/bb-squad-logs}"

cd "$ROOT"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Нужен $ENV_FILE (как у bb-squad-collector)"
  exit 1
fi

if [[ ! -d "$VENV" ]]; then
  echo "Сначала: bash scripts/install-collector-on-vps.sh"
  exit 1
fi
PY="$VENV/bin/python"
"$VENV/bin/pip" install -q -r "$SCRIPTS/requirements-squad-collector.txt"

mkdir -p "$ARCHIVE_ROOT"

# Дописать env, если ключей ещё нет
if ! grep -q '^BB_LOG_ARCHIVE_ROOT=' "$ENV_FILE" 2>/dev/null; then
  cat >> "$ENV_FILE" <<EOF

# --- Long-term log archive (immutable) ---
BB_LOG_ARCHIVE_ROOT=$ARCHIVE_ROOT
BB_LOG_ARCHIVE_POLL_SEC=300
BB_LOG_ARCHIVE_GZ_DAYS=90
BB_LOG_ARCHIVE_SERVERS=TR1,TR2,TR3,TR4,TR5,PB1
EOF
  echo "Дописан BB_LOG_ARCHIVE_* в $ENV_FILE"
fi

echo "==> first full pull (may take a while)"
"$PY" "$SCRIPTS/squad_log_archive.py" --once --full || true

if ! command -v pm2 >/dev/null; then
  npm install -g pm2
fi

echo "==> pm2 start $NAME"
pm2 delete "$NAME" 2>/dev/null || true
pm2 start "$SCRIPTS/squad_log_archive.py" \
  --name "$NAME" \
  --interpreter "$PY" \
  --cwd "$SCRIPTS" \
  --restart-delay 10000 \
  --max-restarts 50 \
  --exp-backoff-restart-delay 2000
pm2 save

echo "==> status"
pm2 status "$NAME"
echo "OK. Архив: $ARCHIVE_ROOT/{PB1,TR1,…}/YYYY-MM/"
echo "Live join/hits по-прежнему: bb-squad-collector (SSH tail)."
echo "Digitize/RP ищут логи и в архиве (bb_log_fleet)."
