# Фаза 10 — slim RP ladder в Postgres

**Дата:** 2026-10-26

## Что в БД

| Таблица | Содержимое |
|--------|------------|
| `RpMeta` | header TRAIN / PUBLIC (step, epoch, …) |
| `RpLadderPlayer` | ник, RP, ранг, slim `matchesJson` |
| `RpScoredMatch` | каталог засчитанных матчей |

Полный `rp-ledger.json` (события Die/Revive) **остаётся на диске** — drilldown как раньше.

## Писатели

После `build_train_rp_ledger` / `build_public_rp_ledger` → `rp_ladder_db.sync_from_path`.

Импорт вручную:

```bash
python3 scripts/rp_ladder_db.py --all
```

`BB_RP_DB_WRITE=0` — не писать. `BB_RP_DB_READ=0` — сайт только с JSON.

## Читатели

`loadRpLadder` / `loadPublicRpLadder` сначала Postgres, иначе файл.

## Не фаза 10

- Перенос event-ledger (434 MB public) в Postgres  
- Удаление JSON-проекций
