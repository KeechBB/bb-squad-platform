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
SQUAD_SERVERS=TR1,TPUB1
SQUAD_LOG_ROOT=/home/squad/servers
SQUAD_INGEST_URL=https://bb-squad.ru/api/ingest/squad-sessions
SQUAD_INGEST_SECRET=…тот же, что в /var/www/bb-squad-platform/.env…
SQUAD_STATE_PATH=/var/www/bb-squad-platform/scripts/squad_collector_state.json
SQUAD_POLL_SEC=5
```

`SQUAD_INGEST_SECRET` возьми с VPS: `grep SQUAD_INGEST_SECRET /var/www/bb-squad-platform/.env`

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

pm2 сам поднимает процесс. При ротации лога коллектор дочитывает `SquadGame-backup-*.log`.

## ПК больше не нужен для логов

Даже в отпуске на неделю данные продолжают писаться в Neon через ingest API.
