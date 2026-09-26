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
- Ежедневный бэкап: `scripts/backup-db.sh` → `/var/backups/bb-squad/` (**00:00 МСК**, хранит **5** последних).
- Cron: `/etc/cron.d/bb-squad-db` (`CRON_TZ=Europe/Moscow`).
- Откат на Neon: вернуть строку из `/root/bb-db-migrate/env.before-migrate` → `pm2 restart bb-squad bb-squad-collector`.
- Neon можно держать 3–7 дней как read-only запас, потом выключить проект.

С ПК к прод-БД: только SSH-туннель (`ssh -L 5432:127.0.0.1:5432 root@91.222.237.91`), порт наружу не светить.

## Обновление кода (деплой)

После `git push` на `main`:

```bash
cd /var/www/bb-squad-platform && bash scripts/deploy.sh
```

Скрипт: `git pull` → билд **на живом** `bb-squad` → удаляет `.next` → `npm run build` → `pm2 restart`.  
Стоп только если явно: `DEPLOY_STOP=1 bash scripts/deploy.sh`. Swap 2G поднимается, если его ещё нет.

## Squad log collector (24/7)

Заходы/выходы TR1+PB1 → **локальный Postgres**. **Только на этом VPS** (`pm2 bb-squad-collector`), не на ПК.  
Установка: [SQUAD-COLLECTOR-VPS.md](./SQUAD-COLLECTOR-VPS.md).
