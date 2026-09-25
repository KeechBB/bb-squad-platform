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
| Тариф | **апгрейд 25.09.2026:** было 2 CPU / 2 ГБ / 40 ГБ → **2×5 ГГц / 4 ГБ RAM / 50 ГБ / 200 Мбит** (после ресайза в панели проверить SSH/pm2) |
| БД | Neon Postgres (`bb-squad`) |
| Репо | https://github.com/KeechBB/bb-squad-platform |
| Бэкап кода на ПК | `D:\BlackBerry\backups\` — файл `bb-squad-platform_2026-09-25_1853.zip` (+ `.env` рядом) |

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

Скрипт: `git pull` → при **available RAM &lt; ~1.8 ГБ** (или `DEPLOY_STOP=1`) стопает `bb-squad`, иначе билдит **на живом** сайте → удаляет `.next` → `npm run build` → `pm2 restart`.  
На старых **2 ГБ** стоп почти всегда срабатывает (иначе OOM). На **4 ГБ** сайт обычно не гаснет на время билда. Swap 2G поднимается, если его ещё нет.

Принудительно со стопом: `DEPLOY_STOP=1 bash scripts/deploy.sh`

## Squad log collector (24/7)

Заходы/выходы TR1+PB1 → Neon. **Только на этом VPS** (`pm2 bb-squad-collector`), не на ПК.  
Установка: [SQUAD-COLLECTOR-VPS.md](./SQUAD-COLLECTOR-VPS.md).
