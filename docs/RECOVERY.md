# Шпаргалка: платформа BB (не потерять)

Если новый ПК / переустановка Windows / «всё забыл» — открой этот файл и `docs/HOSTING.md`.  
**Секреты (пароли, Steam key, DATABASE_URL) сюда не пишем** — только где лежат и что оплачивать.

Агент Cursor: при вопросах «где сервер / что платить / как восстановить» — опираться на этот файл.

**Помощник по сайту:** онбординг и доступы — [COLLAB.md](./COLLAB.md) (деплой без root — [COLLAB-DEPLOY.md](./COLLAB-DEPLOY.md)).

---

## Что у нас есть (картина целиком)

| Часть | Где | Зачем |
|--------|-----|--------|
| Сайт регистрации (Next.js) | **Timeweb Cloud VPS** | Страницы, Steam-вход, анкета |
| База данных (Postgres) | **тот же VPS** (`bb_squad` @ localhost) | Пользователи, сессии, кланы |
| Код платформы | GitHub `KeechBB/bb-squad-platform` | Исходники |
| Таблица КВ / рейтинг | GitHub Pages `KeechBB/blackberry-kv` | Статика, **не** регистрация |
| Домен | `bb-squad.ru` | HTTPS на VPS |

**Не путать:** Vercel отменили (SMS не приходит). Хостинг сайта = Timeweb, не Vercel.

---

## Оплаты (обязательно продлевать)

| Сервис | Что | Примерная цена | Где смотреть |
|--------|-----|----------------|--------------|
| **Timeweb Cloud** | VPS Mysterious Lacerta | ~**900 ₽/мес** (+ апгрейд тарифа) | timeweb.cloud → Биллинг |
| **Домен bb-squad.ru** | Регистрация домена | раз в год (у регистратора) | где покупали домен |
| **GitHub** | репо | 0 ₽ (публичные) | github.com/KeechBB |

Neon больше не обязателен (после переноса на VPS). Старый проект Free можно удалить через несколько дней.  
Если баланс Timeweb = 0 → **сайт и БД лягут**.  
Домен не оплатишь → не привяжешь красивый адрес.

Напоминание агенту: при сессиях про платформу **спрашивать/напомнить** про оплату Timeweb и домен.

---

## Сервер (Timeweb) — факты

- Панель: [https://timeweb.cloud](https://timeweb.cloud)
- Аккаунт / id в панели встречался: `zv854398`
- Имя сервера: **Mysterious Lacerta**
- **IPv4: `91.222.237.91`**
- SSH: `ssh root@91.222.237.91`
- ОС: Ubuntu
- Регион: Санкт-Петербург
- Тариф: апгрейд 25.09.2026 → **2×5 ГГц / 4 ГБ / 50 ГБ / 200 Мбит** (см. HOSTING)
- Консоль в браузере: сервер → вкладка **Консоль** (логин `root`, пароль во вкладке **Доступ**)
- Пароль root: **только в панели Timeweb** (глазик / сброс). В чат и в git не класть.

### Что стоит на сервере

- Каталог сайта: `/var/www/bb-squad-platform`
- Node 20 + npm
- **Postgres** (localhost): БД `bb_squad`, роль `bb_squad`
- Процесс: **pm2** имена `bb-squad`, `bb-squad-collector`
- Бэкапы БД: `/var/backups/bb-squad/` через `scripts/backup-db.sh`
- Полезные команды на сервере:
  ```bash
  pm2 status
  pm2 logs bb-squad
  pm2 restart bb-squad
  cd /var/www/bb-squad-platform && bash scripts/deploy.sh
  bash /var/www/bb-squad-platform/scripts/backup-db.sh
  ```
- Старт: `npm start` → `next start`
- URL: **https://bb-squad.ru** (запасной `http://91.222.237.91:3000`)

Файл `.env` на сервере (`/var/www/bb-squad-platform/.env`):
- `DATABASE_URL` — **локальный** Postgres (`127.0.0.1`), не Neon
- `NEXTAUTH_URL` — `https://bb-squad.ru`
- `NEXTAUTH_SECRET`
- `STEAM_API_KEY`

Локальная копия для разработки: `Новый Проект Кича/platform/.env` (в git **не** коммитится). Для доступа к прод-БД с ПК — SSH-туннель, не открывать 5432 наружу.

---

## Postgres на VPS (база)

- Перенос с Neon: `scripts/migrate-neon-to-vps.sh` (нужен ещё Neon URL в `.env`).
- После миграции бэкап Neon: `/root/bb-db-migrate/env.before-migrate`.
- Ежедневный dump: cron на `scripts/backup-db.sh`.

Старый Neon (архив / откат несколько дней):
- Сайт: [https://console.neon.tech](https://console.neon.tech)
- Проект: **bb-squad**, регион London, Free

Neon Auth / BetterAuth **не используем** — вход через Steam (NextAuth).

---

## Steam Web API

- Страница ключа: [https://steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey)
- **Domain Name** сейчас должен быть: `91.222.237.91` (без http и порта)
- Когда повесим домен — сменить Domain на `bb-squad.ru` и обновить `NEXTAUTH_URL` + ключ/домен
- Старые ключи с `localhost` отзывать, если светились

---

## GitHub

- Платформа: https://github.com/KeechBB/bb-squad-platform  
- Таблица КВ: https://github.com/KeechBB/blackberry-kv  
- Локально: `D:\BlackBerry\Новый Проект Кича\platform\` и `...\KV\public\`

После смены кода платформы:
1. `git push` в `bb-squad-platform`
2. На сервере: `git pull` + build + `pm2 restart bb-squad`

---

## Восстановление с нуля (краткий чеклист)

1. Оплатить / зайти в **Timeweb**, поднять VPS (или этот же, если жив).
2. На сервере: Node 20, Postgres, clone `bb-squad-platform`, `.env` с локальным `DATABASE_URL`, `npm install && npm run build`, pm2.
3. Восстановить БД из `/var/backups/bb-squad/*.dump` (`pg_restore`) или заново `prisma db push` + импорт.
4. Steam Domain = `bb-squad.ru`.
5. Открыть URL, проверить «Войти через Steam».

Подробные команды — `HOSTING.md`, `scripts/migrate-neon-to-vps.sh`, `scripts/backup-db.sh`.

---

## Что ещё не сделано (Phase 0 хвост)

- [ ] Поле **@Telegram** в регистрации
- [ ] Домен **bb-squad.ru** → этот VPS + HTTPS (nginx + Let's Encrypt)
- [ ] DNS: корень платформа vs `kv.` для таблицы КВ
- [ ] Steam Domain обновить под домен

---

## Контакты «куда стучаться если забыл»

1. Этот файл: `platform/docs/RECOVERY.md`
2. `platform/docs/HOSTING.md` — IP и сервер
3. `platform/docs/JOURNAL.md` — хронология
4. `platform/docs/ROADMAP.md` — план фич
5. Спросить агента Cursor: «напомни хостинг BB / IP / что оплачивать»
