# Журнал работы (append-only)

Писать коротко после сессий. Старые строки не затирать.

## 2026-09-19

- Вход через Steam на https://bb-squad.ru работает (профиль Keech в Neon). Фикс: IPv4 для Neon (`gai.conf` / disable IPv6 на VPS).
- HTTPS: certbot на Timeweb для `bb-squad.ru` + `www` — ок. Дальше: `NEXTAUTH_URL=https://bb-squad.ru`, Steam Domain `bb-squad.ru`.
- Домен без IP: инструкция `docs/DOMAIN.md` — A `@`/`www` → `91.222.237.91`, CNAME `kv` → `keechbb.github.io`; nginx; HTTPS; Steam Domain `bb-squad.ru`. КВ → `kv.bb-squad.ru`.
- 2026-09-19: КВ внутри аккаунта — `/cw` на платформе (шапка Keech/Выйти + iframe таблицы). Публичный `kv.bb-squad.ru` без сессии — это нормально.
- На `bb-squad.ru` (таблица КВ) справа сверху **Войти / Регистрация** → платформа `http://91.222.237.91:3000`. На платформе AuthBar: Войти + Регистрация (Steam).
- Зафиксирована шпаргалка восстановления и оплат: `docs/RECOVERY.md` (+ HOSTING). Timeweb ~900 ₽/мес, Neon Free, домен раз в год. IP `91.222.237.91`, pm2 `bb-squad`, URL :3000. Агент напоминает про оплату.
- Phase 0 хостинг: сайт на VPS **online** (pm2 `bb-squad`). URL временно: http://91.222.237.91:3000 . Steam Domain = IP. Дальше: проверка входа, домен, Telegram в анкете.
- Phase 0 хостинг: Vercel отпал (SMS/санкции). Взят **Timeweb Cloud VPS** — сервер **Mysterious Lacerta**, Ubuntu, СПб, 2 CPU / 2 ГБ / 40 ГБ. **IPv4: `91.222.237.91`**. SSH: `ssh root@91.222.237.91`. База по-прежнему Neon. Дальше: поставить Node + деплой `bb-squad-platform` на этот IP.
- Phase 0: Neon `bb-squad` — DATABASE_URL в `.env`, `prisma db push` успешен (таблица User в облаке). Дальше: @Telegram в анкете, Vercel, DNS.
- Phase 0: Кич создал Neon-проект `bb-squad` (Free, London). Prisma в platform переведена с sqlite на postgresql. Дальше: вставить DATABASE_URL в `.env` (не в чат) → `npm run db:push` → Vercel.

## 2026-09-18 / 19

- Куплен домен bb-squad.ru; DNS зона настроена на GitHub Pages, но в интернете NXDOMAIN — ждём реестр; CNAME с Pages временно снят, сайт КВ снова на github.io.
- Публичная таблица КВ: keechbb.github.io/blackberry-kv (дизайн BB, прозрачный лого).
- Треня GooseBay: карта 1 VDV73-CAF0, карта 2 CAF0-VDV31 → trenirovki-kda-16-30.xlsx.
- Старт платформы: Next.js + Steam + регистрация → github.com/KeechBB/bb-squad-platform.
- Зафиксированы цели: открытая регистрация, sqstat 21:00/21:30, веб-стата+рейтинг, клан/команда; документы VISION + ROADMAP + это JOURNAL.
- Steam API Key выдан на localhost (был в чате — при проде revoke/новый).
- Добавлен пункт 5: полный профиль — история матчей, стата (игра + приходы), клан/команда, замечания/предупреждения.
- Добавлен пункт 6: админ-панель — кланы/команды, ручной ввод/правка матчей, редактирование профилей; доступ отдельный (isAdmin).
- Добавлено: интеграция ежедневного ТГ-бота «будешь на трене?» — стату на сайте кто ответил/кто нет; в регистрацию обязательный @Telegram для сверки.
- Зафиксировано: VISION не финальный объём — идеи докидываются по мере появления.
- Добавлено: логи сервера Squad — фиксировать join/leave по Steam ID (точнее sqstat-снимков); нужен доступ к логам или SquadJS.
- Зафиксирован запрос главы HR: кабинет клана — (1) CSV ответов боту Yes/No/Late за период, (2) 2× CSV пользователей + ответов по датам, (3) edit identity без матч-статы, (4) замечания, (5) тонкие права-переключатели (HRD / edit / delete / exports). → VISION §7, ROADMAP Phase 1c.
- Уточнение Кича: HR — **отдельный вид прав** (`clan_hr`), не platform-admin; scope = свой ClanID; внутри — матрица переключателей.
- Каркас живого ростера всего клана: `sostav/tg-roster-bot` → `ves-klan.md`; агент читает файл. Нужен токен бота + `/seed` от Кича.
