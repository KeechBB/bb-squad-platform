# Деплой платформы на bb-squad.ru

GitHub Pages (таблица КВ) и эта платформа — **разные** вещи. Платформе нужен Node (Vercel).

## Важно про базу

SQLite на Vercel **не сохраняется**. Для продакшена:

1. Создай бесплатную БД [Neon](https://neon.tech) (Postgres).
2. В `prisma/schema.prisma` поменяй:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

3. `DATABASE_URL` = connection string из Neon.

Пока тестируешь только локально — оставляй `sqlite`.

## Шаги

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
