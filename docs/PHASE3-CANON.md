# Фаза 3 — сайт читает канон

**Дата:** 2026-10-26  
**Статус:** `/kv-static` + `loadKvJsonCached` overlay TRAIN/CW из `CanonMatch`.

## Что читает канон

| Путь | Поведение |
|------|-----------|
| `data/training/YYYY-MM.json` | disk + overlay строк из канона |
| `data/YYYY-MM.json` (КВ) | disk + overlay (upcoming/cancel с диска) |
| `data/training/players/*.json` | из канона, если есть игроки |
| `data/players/*.json` | из канона, если есть игроки |

Заголовок ответа: `X-KV-Source: canon-overlay` (иначе `vps-disk`).

Отключение: `BB_CANON_READ=0`.

## Модули

- `src/lib/canonMatchRead.ts`
- `src/app/kv-static/[[...path]]/route.ts`
- `src/lib/kvLocal.ts` (home / профили / SSR)

JSON на диске **не удаляем** — fallback и слоты без канона.

## Дальше

- Screenshot → SCREENSHOT source
- Явка hourly MSK
- Siphon / verifier
