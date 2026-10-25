# Фаза 2 — collector пишет в канон

**Дата:** 2026-10-26  
**Статус:** sync_train / sync_cw → `CanonMatch` после конца матча.  
**JSON kv-cache** по-прежнему пишется; сайт пока читает JSON.

## Поток

```
конец слоя (лог) → sync_train / sync_cw → JSON (+ players)
                              └→ canon_match_write.py → Postgres CanonMatch
```

| Kind | Когда в канон |
|------|----------------|
| TRAIN | сразу после `upsert_month` (матч уже закрыт) |
| CW | только при `finalize` (оба раунда закрыты) |

`source = LOG`. Отключение: `BB_CANON_WRITE=0`.

## Модуль

`scripts/canon_match_write.py` — psycopg2 upsert по `legacyId` / `matchKey`, игроки перезаписываются.

## Не фаза 2

- Сайт `/tm` `/cw` читает канон (фаза 3)
- Screenshot → `source=SCREENSHOT`
- Явка hourly / siphon / verifier
