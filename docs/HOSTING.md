# Хостинг платформы (Timeweb VPS)

Vercel не используем (SMS). Сайт крутится на VPS, база — Neon.

| | |
|--|--|
| Провайдер | Timeweb Cloud |
| Имя в панели | Mysterious Lacerta |
| IPv4 | **91.222.237.91** |
| SSH | `ssh root@91.222.237.91` |
| ОС | Ubuntu |
| Регион | Санкт-Петербург |
| Тариф | ~2 CPU / 2 ГБ / 40 ГБ |
| БД | Neon Postgres (`bb-squad`) |
| Репо | https://github.com/KeechBB/bb-squad-platform |

Пароль root — только в панели Timeweb (в чат/репо не писать).

Сайт: **https://bb-squad.ru** / **https://www.bb-squad.ru** (HTTPS Let's Encrypt, 2026-09-19).  
Запасной IP: `http://91.222.237.91:3000`  
Таблица КВ: **https://kv.bb-squad.ru/**  
Инструкция: [DOMAIN.md](./DOMAIN.md)  
Помощник по разработке: [COLLAB.md](./COLLAB.md)

## Обновление кода (деплой)

После `git push` на `main`:

```bash
cd /var/www/bb-squad-platform && bash scripts/deploy.sh
```

Скрипт: `git pull` → **стоп `bb-squad`** (освободить RAM) → удаляет `.next` → `npm run build` → старт pm2.  
На тарифе **2 ГБ** нельзя билдить Next, пока крутится `next-server` — ядро убивает процесс (`Out of memory`). Скрипт также поднимает **2G swap**, если его ещё нет.

Если `git pull` пишет `Already up to date`, а коммита нет — проверь `git log -1 --oneline` (нужен свежий `6a575cc` или новее).

Так после выкладки сайт не «залипает» на старых чанках. HTML отдаётся с `no-store` (см. `next.config.ts`).

## Squad log collector (24/7)

Заходы/выходы TR1+PB1 → Neon. **Только на этом VPS** (`pm2 bb-squad-collector`), не на ПК.  
Установка: [SQUAD-COLLECTOR-VPS.md](./SQUAD-COLLECTOR-VPS.md).
