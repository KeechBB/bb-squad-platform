# Коллектор логов Squad — 24/7 на VPS (не на ПК)

## Зачем

ПК Кича выключается / отпуск → заходы и выходы с TR1/PB1 не пишутся, backup-логи
ротируются. Коллектор должен жить на **том же VPS, где сайт** (`91.222.237.91`).

Нагрузка: лёгкий Python + SSH раз в ~5 с — на Cloud-40 почти незаметно.

## Установка (консоль Timeweb / SSH root)

```bash
cd /var/www/bb-squad-platform
git pull

# 1) env коллектора (пароли с ПК, не в git)
nano scripts/.squad-collector.env
```

Нужны как минимум:

```env
SQUAD_SSH_HOST=194.93.2.107
SQUAD_SSH_PORT=2022
SQUAD_SSH_USER=squad
SQUAD_SSH_PASSWORD=…пароль game-сервера…
SQUAD_SERVERS=TR1,TR2,TPUB1
SQUAD_LOG_ROOT=/home/squad/servers
SQUAD_INGEST_URL=https://bb-squad.ru/api/ingest/squad-sessions
# опционально (по умолчанию …/api/ingest/squad-hits):
# SQUAD_HITS_INGEST_URL=https://bb-squad.ru/api/ingest/squad-hits
SQUAD_INGEST_SECRET=…тот же, что в /var/www/bb-squad-platform/.env…
SQUAD_STATE_PATH=/var/www/bb-squad-platform/scripts/squad_collector_state.json
SQUAD_POLL_SEC=5

# Логи: один кэш на все серверы (TR3…TRn без правок кода)
# BB_LOG_CACHE_ROOT=/var/www/bb-squad-platform/scripts/_tmp_squad_logs
# BB_LOG_SYNC_WORKERS=4
# BB_TRAIN_SYNC_SERVERS=TR1,TR2,TR3   # опционально сузить вечерний digitize

# Telegram через Cloudflare Worker (VPS не достучится до api.telegram.org)
BB_TG_CHAT_ID=1806167653
BB_TG_RELAY_URL=https://bb-squad-alert.lgsghla.workers.dev
BB_TG_RELAY_SECRET=…
BB_TG_RP_LAG_MIN=15
# опционально прямой токен (с VPS обычно не работает):
# BB_TG_BOT_TOKEN=…

# Алерты: сайт/pm2/нагрузка/кеш — cron
#   bash scripts/install-bb-alerts-cron.sh
```

`SQUAD_INGEST_SECRET` возьми с VPS: `grep SQUAD_INGEST_SECRET /var/www/bb-squad-platform/.env`  
Новые тренировочные сервера: добавь `TR3` в `SQUAD_SERVERS` — SSH/pin/RP/очередь подхватят сами.

Коллектор шлёт **два** потока: join/leave (посещаемость TR1+TR2+TPUB1) и `BBHitZone` / DeployRole с **TR1 и TR2** (хитмап и киты в профиле).

После первого деплоя hit-ingest — один раз долить историю из логов (через venv коллектора, не системный `python`):

```bash
cd /var/www/bb-squad-platform/scripts
.venv-collector/bin/python backfill_squad_hits.py
```

```bash
chmod +x scripts/install-collector-on-vps.sh
bash scripts/install-collector-on-vps.sh
pm2 status
pm2 logs bb-squad-collector --lines 40
```

Должен быть `bb-squad` (сайт) и `bb-squad-collector` (логи) → **online**.

## После установки

1. На **Windows** останови коллектор: диспетчер задач → python `squad_collector*` → снять.
2. Удали ярлык из Автозагрузки: `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\BB-Squad-Log-Collector.lnk`
3. Больше не запускай `start-squad-collector-watchdog.cmd` на ПК.

## Если упал

```bash
pm2 restart bb-squad-collector
pm2 logs bb-squad-collector --lines 80
```

pm2 сам поднимает процесс. При ротации лога коллектор дочитывает `SquadGame-backup-*.log`
(включая `BBHitZone:`). Раз в час — повторный catchup свежих backup.

## Висяки без выхода (`… – _`)

1. Разово дописать leave из логов:  
   `python scripts/reconcile_open_leaves.py` (с VPS или ПК с `.squad-collector.env` + `DATABASE_URL`).
2. Авто: ingest закрывает open-сессии старше **18 ч** (`SQUAD_STALE_OPEN_HOURS`).  
   Коллектор раз в минуту шлёт пустой POST, чтобы это срабатывало даже без новых событий.

## ПК больше не нужен для логов

Даже в отпуске на неделю данные продолжают писаться в Postgres через ingest API
(заходы + попадания TR1/TR2).
