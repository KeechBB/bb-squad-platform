# Коллектор заходов/выходов Squad → bb-squad.ru

Читает `SquadGame.log` по SSH и шлёт события в `POST /api/ingest/squad-sessions`
(join/leave) и `POST /api/ingest/squad-hitzones` (строки `BBHitZone:` с мода
[BBHitZoneLogger](../mods/BBHitZoneLogger/README.md)).
В БД попадают **только** игроки, у которых есть аккаунт на сайте (Steam ID).

## Важно: где крутить

**Продакшен — только на VPS сайта** (Timeweb), через pm2. Не на домашнем ПК:
ПК спит / отпуск → дыры в посещаемости, backup-логи уезжают.

→ Пошагово: [../docs/SQUAD-COLLECTOR-VPS.md](../docs/SQUAD-COLLECTOR-VPS.md)

ПК допустим только для отладки. После переноса на VPS Windows-watchdog выключить.

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
export SQUAD_SERVERS=TR1,TPUB1
export SQUAD_LOG_ROOT=/home/squad/servers
# legacy single-log still works:
# export SQUAD_LOG_PATH=/home/squad/servers/TR1/SquadGame/Saved/Logs/SquadGame.log
# export SQUAD_SERVER_KEY=TR1
export SQUAD_INGEST_URL=https://bb-squad.ru/api/ingest/squad-sessions
export SQUAD_INGEST_SECRET='тот же секрет'
export SQUAD_STATE_PATH=./squad_collector_state.json

python squad_log_collector.py
```

Держать процесс постоянно через watchdog (рекомендуется на Windows):

```bat
cd platform\scripts
start-squad-collector-watchdog.cmd
```

Или: `python -u squad_collector_watchdog.py`

**Автозапуск при входе в Windows** (чтобы 24/7 без ручного старта):

```powershell
cd platform\scripts
# от админа — надёжнее; без админа тоже часто работает:
powershell -ExecutionPolicy Bypass -File .\install-squad-collector-autostart.ps1
```

Задача: `BB-Squad-Log-Collector`. Silent-старт: `start-squad-collector-watchdog-silent.cmd`.

Watchdog сам поднимает `squad_log_collector.py`, если тот упал, и перезапускает,
если `squad_collector_state.json` не обновлялся слишком долго (зависший SSH).
После старта есть **grace ~3 мин**, чтобы не устроить рестарт-шторм на старом state.
Лог: `_watchdog.log`.

Если за вечер тренировки у части игроков нет выхода (`leftAt` пустой) — обычно
коллектор лежал, а лог уже уехал в `SquadGame-backup-*.log`. Закрыть из бэкапа:

```bat
python _tmp_backfill_leaves_day.py 2026-09-22
```

Альтернатива: pm2 / systemd / screen. Пароль SSH и state-файл в git не класть.
Первый старт читает лог с конца (live). История: `SQUAD_BACKFILL=1`.
Тренировки обычно на **TR1** (пароль на сервере) — без TR1 в `SQUAD_SERVERS` заходы на тренировку не попадут в таблицу.

## 3. Профиль

В `/profile` и `/players/[nick]` — блок «Тренировки / сервер»: сессии, минуты за 30 дней, метка вовремя / опоздание.
