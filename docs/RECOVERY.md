# Шпаргалка: платформа BB (не потерять)

Если новый ПК / переустановка Windows / «всё забыл» — открой этот файл и `docs/HOSTING.md`.  
**Секреты (пароли, Steam key, DATABASE_URL) сюда не пишем** — только где лежат и что оплачивать.

Агент Cursor: при вопросах «где сервер / что платить / как восстановить» — опираться на этот файл.

---

## Что у нас есть (картина целиком)

| Часть | Где | Зачем |
|--------|-----|--------|
| Сайт регистрации (Next.js) | **Timeweb Cloud VPS** | Страницы, Steam-вход, анкета |
| База данных (Postgres) | **Neon** проект `bb-squad` | Пользователи, анкеты |
| Код платформы | GitHub `KeechBB/bb-squad-platform` | Исходники |
| Таблица КВ / рейтинг | GitHub Pages `KeechBB/blackberry-kv` | Статика, **не** регистрация |
| Домен | `bb-squad.ru` | Пока КВ/DNS отдельно; платформа временно по IP |

**Не путать:** Vercel отменили (SMS не приходит). Хостинг сайта = Timeweb, не Vercel.

---

## Оплаты (обязательно продлевать)

| Сервис | Что | Примерная цена | Где смотреть |
|--------|-----|----------------|--------------|
| **Timeweb Cloud** | VPS Mysterious Lacerta | ~**900 ₽/мес** | timeweb.cloud → Биллинг |
| **Neon** | Postgres Free | **0 ₽** (лимит 0.5 ГБ) | console.neon.tech |
| **Домен bb-squad.ru** | Регистрация домена | раз в год (у регистратора) | где покупали домен |
| **GitHub** | репо | 0 ₽ (публичные) | github.com/KeechBB |

Если баланс Timeweb = 0 → **сайт ляжет**. Neon Free при простое ок, но аккаунт не удалять.  
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
- Тариф: ~2 CPU / 2 ГБ RAM / 40 ГБ NVMe
- Консоль в браузере: сервер → вкладка **Консоль** (логин `root`, пароль во вкладке **Доступ**)
- Пароль root: **только в панели Timeweb** (глазик / сброс). В чат и в git не класть.

### Что стоит на сервере

- Каталог сайта: `/var/www/bb-squad-platform`
- Node 20 + npm
- Процесс: **pm2** имя `bb-squad`
- Полезные команды на сервере:
  ```bash
  pm2 status
  pm2 logs bb-squad
  pm2 restart bb-squad
  cd /var/www/bb-squad-platform && git pull && npm install && npm run build && pm2 restart bb-squad
  ```
- Старт: `npm start` → `tsx server.ts` (Next + WS «Карт-дуэль» на `/api/reaction/race/ws`).
  Если pm2 когда-то был заведён через `next start`, пересоздай:
  `pm2 delete bb-squad && cd /var/www/bb-squad-platform && pm2 start npm --name bb-squad -- start && pm2 save`
- nginx: в `location /` нужны `Upgrade` / `Connection "upgrade"` (см. `deploy/nginx-bb-squad.conf`).
- Временный URL: **http://91.222.237.91:3000**

Файл `.env` на сервере (`/var/www/bb-squad-platform/.env`) — 4 переменные:
- `DATABASE_URL` — строка из Neon Connect
- `NEXTAUTH_URL` — сейчас `http://91.222.237.91:3000`
- `NEXTAUTH_SECRET`
- `STEAM_API_KEY`

Локальная копия для разработки: `Новый Проект Кича/platform/.env` (в git **не** коммитится).

---

## Neon (база)

- Сайт: [https://console.neon.tech](https://console.neon.tech)
- Проект: **bb-squad**
- Регион: AWS Europe West 2 (London)
- Plan: Free (0.5 GB)
- Project id встречался: `falling-wind-…` (точный смотри в Neon → Project info)
- Строка подключения: Neon → **Connect** → Copy → в `DATABASE_URL`
- Таблицы созданы через `prisma db push` (модель `User`)

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
2. Зайти в **Neon**, взять Connection string.
3. На сервере: Node 20, clone `bb-squad-platform`, `.env` с 4 ключами, `npm install && npm run build`, pm2.
4. Steam Domain = IP или домен.
5. Открыть URL, проверить «Войти через Steam».

Подробные команды первой установки — в истории чата Phase 0 / `DEPLOY.md` + этот файл.

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
