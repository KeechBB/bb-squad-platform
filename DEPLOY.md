# Деплой платформы на bb-squad.ru

GitHub Pages (таблица КВ) и эта платформа — **разные** вещи. Платформе нужен Node (Vercel).

## Важно про базу

Прод и нормальная разработка — **Postgres в Neon** (облако).

1. Neon → проект → **Connect** → скопируй Connection string.
2. Вставь в `platform/.env` как `DATABASE_URL=...` (в чат не кидать).
3. В `prisma/schema.prisma` уже `provider = "postgresql"`.
4. Локально: `npm run db:push` — создаст таблицы в Neon.

SQLite (`file:./dev.db`) больше не используем для платформы.

Старый чеклист Vercel:

1. Залей репо на GitHub (например `KeechBB/bb-squad-platform`).
2. [vercel.com](https://vercel.com) → Login with GitHub → Import project.
3. Environment Variables:
   - `NEXTAUTH_URL` = `https://bb-squad.ru` (или временный `*.vercel.app`)
   - `NEXTAUTH_SECRET` = случайная строка (например `openssl rand -hex 32`)
   - `STEAM_API_KEY` = ключ Steam
   - `DATABASE_URL` = Neon Postgres URL
4. Deploy.
5. Domain: Vercel → Project → Domains → добавь `bb-squad.ru` и `www.bb-squad.ru`.
6. DNS (если ещё не на GitHub Pages для корня): для платформы корень должен смотреть на **Vercel**, не на GitHub Pages.

### Конфликт с таблицей КВ на том же домене

Сейчас `bb-squad.ru` привязан к **GitHub Pages** (таблица). Платформа на том же корне не уживётся без выбора:

- **Вариант A:** платформа = `bb-squad.ru`, таблица КВ = `kv.bb-squad.ru` (отдельный CNAME на GitHub Pages), или оставить `keechbb.github.io/blackberry-kv/`.
- **Вариант B:** платформа = `app.bb-squad.ru` на Vercel, корень оставить под таблицу.

Рекомендация: **корень = платформа**, таблица на поддомене `kv.bb-squad.ru`.

7. Steam API Key → Domain Name: `bb-squad.ru`.

## Проверка

Открой сайт → «Войти через Steam» → анкета → `/profile`.
