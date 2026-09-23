#!/usr/bin/env bash
# Установка Squad log collector на VPS сайта (Timeweb), 24/7 через pm2.
# Запуск на сервере: bash scripts/install-collector-on-vps.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPTS="$ROOT/scripts"
ENV_FILE="$SCRIPTS/.squad-collector.env"
VENV="$SCRIPTS/.venv-collector"
NAME="bb-squad-collector"

cd "$ROOT"

echo "==> Python + venv"
if ! command -v python3 >/dev/null; then
  apt-get update -y
  apt-get install -y python3 python3-venv python3-pip
fi
if ! python3 -c "import venv" 2>/dev/null; then
  apt-get update -y
  apt-get install -y python3-venv
fi

if [[ ! -d "$VENV" ]]; then
  python3 -m venv "$VENV"
fi
# shellcheck disable=SC1091
source "$VENV/bin/activate"
pip install -q -U pip
pip install -q -r "$SCRIPTS/requirements-squad-collector.txt"
PY="$VENV/bin/python"

if [[ ! -f "$ENV_FILE" ]]; then
  cat > "$ENV_FILE" <<'EOF'
# Скопируй с ПК (platform/scripts/.squad-collector.env) — пароли в git не класть.
SQUAD_SSH_HOST=194.93.2.107
SQUAD_SSH_PORT=2022
SQUAD_SSH_USER=squad
SQUAD_SSH_PASSWORD=
SQUAD_SERVERS=TR1,TPUB1
SQUAD_LOG_ROOT=/home/squad/servers
SQUAD_INGEST_URL=https://bb-squad.ru/api/ingest/squad-sessions
SQUAD_INGEST_SECRET=
SQUAD_STATE_PATH=/var/www/bb-squad-platform/scripts/squad_collector_state.json
SQUAD_POLL_SEC=5
EOF
  echo "Создан $ENV_FILE — заполни пароль SSH и SQUAD_INGEST_SECRET, потом снова запусти скрипт."
  exit 1
fi

# Проверка обязательных ключей
"$PY" - <<'PY'
import os, sys
from pathlib import Path
p = Path("scripts/.squad-collector.env")
for line in p.read_text(encoding="utf-8").splitlines():
    line=line.strip()
    if not line or line.startswith("#") or "=" not in line: continue
    k,_,v=line.partition("=")
    os.environ[k.strip()] = v.strip().strip("'").strip('"')
need = ["SQUAD_SSH_HOST","SQUAD_SSH_USER","SQUAD_SSH_PASSWORD","SQUAD_INGEST_URL","SQUAD_INGEST_SECRET"]
miss=[k for k in need if not os.environ.get(k)]
if miss:
    print("Не хватает в .squad-collector.env:", ", ".join(miss))
    sys.exit(1)
print("env ok")
PY

if ! command -v pm2 >/dev/null; then
  npm install -g pm2
fi

echo "==> pm2 start $NAME"
pm2 delete "$NAME" 2>/dev/null || true
pm2 start "$SCRIPTS/squad_log_collector.py" \
  --name "$NAME" \
  --interpreter "$PY" \
  --cwd "$SCRIPTS" \
  --restart-delay 5000 \
  --max-restarts 100 \
  --exp-backoff-restart-delay 1000
pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null || true

echo "==> status"
pm2 status "$NAME"
echo "OK. Коллектор на VPS 24/7. На Windows ПК — останови watchdog / убери из Автозагрузки."
