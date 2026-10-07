# Хостинг платформы (Timeweb VPS)

Vercel не используем (SMS). Сайт и **Postgres** крутятся на одном VPS.

| | |
|--|--|
| Провайдер | Timeweb Cloud |
| Имя в панели | Mysterious Lacerta |
| IPv4 | **91.222.237.91** |
| SSH | `ssh root@91.222.237.91` |
| ОС | Ubuntu |
| Регион | Санкт-Петербург |
| Тариф | **апгрейд 25.09.2026:** было 2 CPU / 2 ГБ / 40 ГБ → **2×5 ГГц / 4 ГБ RAM / 50 ГБ / 200 Мбит** |
| БД | **Postgres на VPS** (`bb_squad`, только `127.0.0.1`) |
| Репо | https://github.com/KeechBB/bb-squad-platform |
| Бэкап кода на ПК | `D:\BlackBerry\backups\` — файл `bb-squad-platform_2026-09-25_1853.zip` (+ `.env` рядом) |

Пароль root — только в панели Timeweb (в чат/репо не писать).

Сайт: **https://bb-squad.ru** / **https://www.bb-squad.ru** (HTTPS Let's Encrypt, 2026-09-19).  
Запасной IP: `http://91.222.237.91:3000`  
Таблица КВ: **https://kv.bb-squad.ru/**  
Инструкция: [DOMAIN.md](./DOMAIN.md)  
Помощник по разработке: [COLLAB.md](./COLLAB.md)

## База данных (Postgres localhost)

- Слушает только localhost — **не** открывать `5432` в firewall.
- `DATABASE_URL` в `/var/www/bb-squad-platform/.env` → `postgresql://bb_squad:…@127.0.0.1:5432/bb_squad`
- Перенос с Neon: `bash scripts/migrate-neon-to-vps.sh` (на сервере, пока в `.env` ещё Neon URL).
- Ежедневный бэкап **БД**: `scripts/backup-db.sh` → `/var/backups/bb-squad/` (**00:00 МСК**, хранит **5** последних).
- Ежедневный **полный** бэкап: `scripts/backup-full.sh` → `/var/backups/bb-squad-full/*.tar.gz` (**00:15 МСК**, хранит **5**).
  Внутри: Postgres dump + код сайта + `.env` + аплоады + nginx/pm2/cron. Без `node_modules`/`.next` (после отката — `npm ci && build`).
  Откат: `bash scripts/restore-full.sh /var/backups/bb-squad-full/bb-squad-full_….tar.gz`
- Cron БД: `/etc/cron.d/bb-squad-db` · полный: `/etc/cron.d/bb-squad-full` (`CRON_TZ=Europe/Moscow`).
- Откат на Neon: вернуть строку из `/root/bb-db-migrate/env.before-migrate` → `pm2 restart bb-squad bb-squad-collector`.
- Neon можно держать 3–7 дней как read-only запас, потом выключить проект.

С ПК к прод-БД: только SSH-туннель (`ssh -L 5432:127.0.0.1:5432 root@91.222.237.91`), порт наружу не светить.

## Обновление кода (деплой)

Агент с ПК Кича ходит на VPS по SSH (`~/.ssh/bb_vps_ed25519` → `root@91.222.237.91`) и сам гоняет деплой, когда Alex пишет «задеплой / на staging / на прод». В Timeweb-консоль лезть не нужно, пока SSH жив.

**Не путать IP:** прод = `91.222.237.91` (Timeweb). Старый/чужой `194.87.92.114` — не этот VPS (SSH туда timeout).

Деплой с ПК: `pwsh scripts/deploy-prod.ps1`  
Проверка «задеплоилось ли»: `bash scripts/verify-deploy.sh` (с ПК) или на VPS `bash scripts/verify-deploy.sh --local --sha <commit>`.

### Прод (народ)

После `git push` на `main`:

```bash
cd /var/www/bb-squad-platform && git pull && bash scripts/deploy.sh
```

Во время деплоя сайт показывает заглушку `public/maintenance.html` (лого BB + «технические работы», авто-refresh 30с) — флаг `maintenance.on`.  
Nginx также отдаёт её на **502/503/504** (когда Next/PM2 лежит), не дефолтную ошибку.  
Один раз обновить nginx с репо: перенести `error_page 502 503 504`, `location = /maintenance.html`, `proxy_intercept_errors on` из `deploy/nginx-bb-squad.conf` в `/etc/nginx/sites-available/bb-squad`, затем `nginx -t && systemctl reload nginx`.

Скрипт: maintenance ON → sync KV cache → `pm2 stop bb-squad` → билд → `pm2 start` → maintenance OFF.  
При sync ledger берётся тот, где **больше матчей** (чтобы тонкий github.io не затирал полный диск).  
Swap 2G поднимается, если его ещё нет.

### Staging (черновик) — смотришь сам, потом льёшь в прод

| | |
|--|--|
| URL | **https://staging.bb-squad.ru** |
| Код | `/var/www/bb-squad-platform-staging` |
| Ветка | `staging` |
| PM2 | `bb-squad-staging` → порт **3001** |
| БД | Postgres `bb_squad_staging` (копия прода, отдельно) |
| DNS | A `staging` → `91.222.237.91` |

**Первый раз (один раз на сервере):**

```bash
cd /var/www/bb-squad-platform && git pull && bash scripts/bootstrap-staging.sh
```

**Обычный цикл:**

```text
1. Правки → push в ветку staging
2. На VPS: cd /var/www/bb-squad-platform-staging && bash scripts/deploy-staging.sh
3. Смотришь https://staging.bb-squad.ru
4. Ок → merge staging → main → bash scripts/deploy.sh (прод)
```

Обновить данные staging из прода (без деплоя кода):

```bash
bash /var/www/bb-squad-platform-staging/scripts/refresh-staging-db.sh
```

Сэкономить RAM, когда черновик не нужен: `pm2 stop bb-squad-staging` (потом `pm2 start bb-squad-staging`).

**Пароль на вход в черновик:** на staging включён gate (`STAGING_GATE_ENABLED=1` + `STAGING_GATE_PASSWORD` в `.env` staging). Без пароля — только окно входа, API/страницы закрыты. На проде эти переменные не ставить.

Steam: если логин на staging ломается — в Steam API Key Domain оставь `bb-squad.ru` (часто хватает) или добавь `staging.bb-squad.ru`.

### Локальный кэш KV (ускорение)

При деплое `scripts/sync_kv_cache.sh` зеркалит **весь** `blackberry-kv/public` в  
`/var/www/bb-squad-platform/data/kv-cache/` (на VPS: `git pull` в `/var/www/blackberry-kv`).  
Живой сайт (`/kv-static`, home API) читает **только диск** — GitHub Pages в горячем пути не используется.  
Nginx отдаёт `/kv-static/` напрямую с диска (см. `deploy/nginx-bb-squad.conf`).  

**Автозалив TR1:** collector пишет training JSON + `data/cache-bust.json` в kv-cache.  
`/tm` и `/cw` берут `v=` из bust на диске (без redeploy).  
`sync_kv_cache.sh` после rsync **не затирает** более полный автозалив training/RP.  
Hot-path рейтинга ТМ: slim `rp-ladder.json`; полный ledger — только drilldown.

## Squad log collector (24/7)

Заходы/выходы TR1+TR2+PB1 **и** попадания BBHitZone (TR1+TR2) → **локальный Postgres**. **Только на этом VPS** (`pm2 bb-squad-collector`), не на ПК.  

Подробности: `docs/SQUAD-COLLECTOR-VPS.md`. После деплоя hit-ingest: `python scripts/backfill_squad_hits.py`.  
Установка: [SQUAD-COLLECTOR-VPS.md](./SQUAD-COLLECTOR-VPS.md).
