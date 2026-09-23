# BlackBerry Platform (bb-squad.ru)

Вход через Steam, ник латиницей, профиль. Статистика — следующим этапом.

**Документы (не терять цели):**

- [docs/VISION.md](./docs/VISION.md) — что строим
- [docs/ROADMAP.md](./docs/ROADMAP.md) — этапы
- [docs/JOURNAL.md](./docs/JOURNAL.md) — что уже сделали
- [docs/RECOVERY.md](./docs/RECOVERY.md) — **восстановление / оплаты / IP** (новый ПК, всё забыл)
- [docs/HOSTING.md](./docs/HOSTING.md) — Timeweb VPS кратко
- [docs/COLLAB.md](./docs/COLLAB.md) — **помощник по сайту** (GitHub, Neon branch, папка Кича)
- [docs/COLLAB-DEPLOY.md](./docs/COLLAB-DEPLOY.md) — деплой без root (второй этап)

## Прод сейчас

- Сайт: Timeweb VPS `http://91.222.237.91:3000` (не Vercel)
- БД: Neon Postgres `bb-squad`
- Оплаты: Timeweb ~900 ₽/мес + домен раз в год; Neon Free


1. Node 20+
2. Скопируй `.env.example` → `.env`
3. [Steam Web API Key](https://steamcommunity.com/dev/apikey) — Domain: `localhost`
4. В `.env`:
   - `STEAM_API_KEY=...`
   - `NEXTAUTH_SECRET=` длинная случайная строка
   - `NEXTAUTH_URL=http://localhost:3000`
5. `npm install`
6. `npm run db:push`
7. `npm run dev` → http://localhost:3000

## Деплой

Прод = **Timeweb VPS** + **Neon**. Vercel не используем.  
См. [docs/RECOVERY.md](./docs/RECOVERY.md), [docs/HOSTING.md](./docs/HOSTING.md), [DEPLOY.md](./DEPLOY.md).
