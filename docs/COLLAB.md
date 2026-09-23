# Совместная разработка — онбординг помощника

Кич = владелец. Помощник = Collaborator на коде (не root VPS / не биллинг).

Связанные доки: [HOSTING.md](./HOSTING.md), [RECOVERY.md](./RECOVERY.md), [SQUAD-COLLECTOR-VPS.md](./SQUAD-COLLECTOR-VPS.md).

**Секреты в этот файл не писать** (пароли, `DATABASE_URL`, Steam key).

---

## 1. GitHub (Кич делает один раз)

Нужен **GitHub login** помощника (не ник в Steam).

```bash
# из любого места, под аккаунтом KeechBB:
gh api -X PUT repos/KeechBB/bb-squad-platform/collaborators/GITHUB_LOGIN -f permission=push
gh api -X PUT repos/KeechBB/blackberry-kv/collaborators/GITHUB_LOGIN -f permission=push
```

Или скрипт на ПК Кича:

```powershell
cd "D:\BlackBerry\Новый Проект Кича\platform"
.\scripts\invite-helper.ps1 -GitHubLogin "GITHUB_LOGIN"
```

Помощник принимает invite на email/GitHub → Notifications.

**Процесс кода:** ветка → PR в `main` → merge (Кич или помощник после ревью). В `main` вдвоём без PR — только мелочи по договорённости.

---

## 2. Папка как у Кича (не весь диск)

Рабочий корень агента: **`Новый Проект Кича`**. Это не один git — два репо + ассеты.

| Путь | Как получить | Зачем |
|------|--------------|--------|
| `platform/` | `git clone https://github.com/KeechBB/bb-squad-platform.git platform` | Сайт |
| `KV/public/` | `git clone https://github.com/KeechBB/blackberry-kv.git KV/public` | Календарь КВ |
| `.cursor/` | zip/синк от Кича (см. `pack-helper-workspace.ps1`) | Правила агента |
| `brand/`, `maps/` | zip/синк от Кича | Лого / фоны превью |
| `KV/previews/`, `KV/2026-09/` и т.п. | zip/синк (без огромного мусора) | Заявки и превью КВ |

**Не копировать помощнику:** `finances/`, `recruiting/` с ПДн, `schodki/` по желанию Кича, любые `.env`, `scripts/.squad-collector.env`, `node_modules/`, `_tmp_*`, Agent Stores Cursor.

Кич собирает пакет:

```powershell
cd "D:\BlackBerry\Новый Проект Кича\platform"
.\scripts\pack-helper-workspace.ps1
# → Desktop\bb-helper-workspace-YYYYMMDD.zip
```

Помощник на своём ПК:

1. Создаёт папку например `D:\BlackBerry\Новый Проект Кича`
2. Клонирует `platform` и `KV/public` как в таблице
3. Распаковывает zip поверх (`.cursor`, `brand`, `maps`, куски `KV`)
4. Cursor → **Open Folder** на этот корень (не только `platform/`)

Свой аккаунт Cursor / подписка. **Не** логиниться под Кичом.

---

## 3. База (Neon) — копия, не прод

Данные юзеров/сессий живут в **Neon**, не в файле на диске.

1. Neon → проект `bb-squad` → **Branches** → Create branch `dev` (или `helper`) от production.
2. Connect → connection string ветки → в `.env` помощника как `DATABASE_URL`.
3. Прод-строка — только у Кича и на VPS.

Если Branch на Free недоступен:

```text
pg_dump (прод) → новая DB bb-squad-dev → restore
```

Обновление копии — по запросу Кича (раз в неделю / перед крупной фичей).

**Запрет:** не вставлять прод-`DATABASE_URL` «чтобы было как на сайте».

---

## 4. Локальный `.env` помощника

Скопировать с [`.env.example`](../.env.example), заполнить у себя:

| Переменная | Откуда |
|------------|--------|
| `DATABASE_URL` | Neon **branch** `dev` / `helper` |
| `NEXTAUTH_URL` | `http://localhost:3000` |
| `NEXTAUTH_SECRET` | свой `openssl rand -hex 32` |
| `STEAM_API_KEY` | Steam → API key на `localhost` (или общий key от Кича, если договорились) |

`SQUAD_INGEST_SECRET` и SSH к game-серверу / коллектор — **не нужны** для UI/API. Не выдавать без нужды.

Запуск:

```bash
cd platform
npm install
npx prisma generate
npm run dev
```

---

## 5. Деплой на прод (второй этап)

Сейчас: merge в `main` → деплой делает **Кич** на VPS:

```bash
cd /var/www/bb-squad-platform && git pull
npm run build && pm2 restart bb-squad
```

Позже (Deployer): отдельный Linux user `deploy`, SSH-ключ помощника, без root и без панели Timeweb — см. [COLLAB-DEPLOY.md](./COLLAB-DEPLOY.md).

Коллектор `bb-squad-collector` и `.squad-collector.env` — только Кич.

---

## 6. Чеклист «помощник готов»

- [ ] Invite принят в оба репо
- [ ] Cursor открыт на корне `Новый Проект Кича`
- [ ] Есть `.cursor/rules`, `brand`, `maps`
- [ ] `.env` с Neon **branch**, сайт открывается на localhost
- [ ] Первая ветка + PR (тест процесса)

## Чеклист «Кич выдал»

- [ ] `invite-helper.ps1 -GitHubLogin …`
- [ ] Neon branch + строка передана лично (не в чат/issue)
- [ ] `pack-helper-workspace.ps1` отдан помощнику
- [ ] Договорились: кто мержит PR, кто деплоит
