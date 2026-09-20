# Коллектор заходов/выходов Squad → bb-squad.ru

Читает `SquadGame.log` по SSH и шлёт события в `POST /api/ingest/squad-sessions`.
В БД попадают **только** игроки, у которых есть аккаунт на сайте (Steam ID).

## 1. На VPS сайта

```bash
cd /var/www/bb-squad-platform
git pull
# в .env добавить:
# SQUAD_INGEST_SECRET="<длинный случайный секрет>"
npx prisma db push
npm run build && pm2 restart bb-squad
```

Секрет: `openssl rand -hex 32`

## 2. Запуск коллектора (ПК или любой хост с SSH)

```bash
cd platform/scripts
pip install -r requirements-squad-collector.txt

export SQUAD_SSH_HOST=194.93.2.107
export SQUAD_SSH_PORT=2022
export SQUAD_SSH_USER=squad
export SQUAD_SSH_PASSWORD='…'
export SQUAD_LOG_PATH=/home/squad/servers/TPUB1/SquadGame/Saved/Logs/SquadGame.log
export SQUAD_SERVER_KEY=TPUB1
export SQUAD_INGEST_URL=https://bb-squad.ru/api/ingest/squad-sessions
export SQUAD_INGEST_SECRET='тот же секрет'
export SQUAD_STATE_PATH=./squad_collector_state.json

python squad_log_collector.py
```

Держать процесс постоянно (pm2 / systemd / screen). Пароль SSH и state-файл в git не класть.
Первый старт читает лог с конца (live). История: `SQUAD_BACKFILL=1`.

## 3. Профиль

В `/profile` и `/players/[nick]` — блок «Тренировки / сервер»: сессии, минуты за 30 дней, метка вовремя / опоздание.
