# Фаза 1 — канон матчей в Postgres (plaza)

**Дата:** 2026-10-26  
**Статус:** схема + импорт из legacy JSON. Сайт пока читает `kv-cache` как раньше.  
**Не удалять:** файлы `KV/public/data/**` и `kv-cache` на VPS.

## Модели

| Модель | Назначение |
|--------|------------|
| `CanonMatch` | Один матч (TRAIN / CW / PUBLIC) |
| `CanonMatchPlayer` | Стата игрока (раунд или сторона) |

`matchKey` (unique): `{YYYY-MM-DD}_{serverKey}_{mapStem}_{HHMM}`  
Пример: `2026-10-25_tr1_cslmutaha_2329`

Legacy: `legacyId` + `(kind, year, month, legacyId)` unique — id из месяца (`02-gorodok`, `25-alpha`).

`PublicMatch` / `SquadServerSession` не трогаем в фазе 1 (паблик позже).

## Источники импорта (только чтение)

| Kind | Месяц | Игроки |
|------|-------|--------|
| TRAIN | `KV/public/data/training/YYYY-MM.json` | `training/players/{legacyId}.json` → `teamA`/`teamB` |
| CW | `KV/public/data/YYYY-MM.json` | `players/{legacyId}.json` → `r1`/`r2` |

На VPS те же пути под `kv-cache` / зеркалом сайта KV.

## Скрипт

```bash
# dry-run
python3 scripts/import_canon_from_kv_cache.py --root /path/to/KV/public/data --dry-run

# upsert в Postgres (DATABASE_URL из .env)
python3 scripts/import_canon_from_kv_cache.py --root /var/www/bb-squad-platform/../kv-cache-or-data --apply
```

Идемпотентно: upsert по `matchKey` и по `(kind, year, month, legacyId)`.

## Критерии готовности фазы 1

1. `prisma db push` на plaza — таблицы `CanonMatch`, `CanonMatchPlayer`.
2. Dry-run импорта показывает числа матчей/игроков ≥ текущих JSON.
3. JSON на диске не трогаются.
4. Документ + скрипт в репо.

## Дальше (не фаза 1)

- Collector пишет в `CanonMatch` после конца матча / скринов.
- Сайт / API читают канон; JSON = экспорт или freeze.
- Verifier / Hunt LIVE / attendance hourly — следующие фазы.
