# Фаза 8 — PUBLIC в CanonMatch + verifier CW

**Дата:** 2026-10-26

## PUBLIC → канон

После ingest `POST /api/ingest/public-matches` — upsert `CanonMatch` kind=`PUBLIC`, source=`LOG`.

Бэкфилл:

```bash
python3 scripts/canon_backfill_public.py
```

Игроки паблика по-прежнему в RP-ledger (не в CanonMatchPlayer на этом шаге).

## Verifier CW

- Сумма kills по срезам раундов (не max).
- Поиск срезов только по prefix matchKey (без чужих карт дня).
