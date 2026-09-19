# BlackBerry Platform (bb-squad.ru)

Вход через Steam, ник латиницей, профиль. Статистика — следующим этапом.

**Документы (не терять цели):**

- [docs/VISION.md](./docs/VISION.md) — что строим
- [docs/ROADMAP.md](./docs/ROADMAP.md) — этапы
- [docs/JOURNAL.md](./docs/JOURNAL.md) — что уже сделали

## Локально

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

## Деплой (Vercel + домен)

См. [DEPLOY.md](./DEPLOY.md).
