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

## Squad log collector (24/7)

Заходы/выходы TR1+PB1 → Neon. **Только на этом VPS** (`pm2 bb-squad-collector`), не на ПК.  
Установка: [SQUAD-COLLECTOR-VPS.md](./SQUAD-COLLECTOR-VPS.md).
