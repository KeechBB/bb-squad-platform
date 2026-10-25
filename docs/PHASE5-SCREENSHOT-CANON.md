# Фаза 5 — скрины → CanonMatch (`SCREENSHOT`)

**Дата:** 2026-10-26  
**Статус:** CLI + skill. После залива JSON со скринов — upsert в Postgres.

## Когда

КВ (и редко трень) оцифрованы агентом/вручную в `kv-cache` JSON → сразу в канон с `source=SCREENSHOT`.  
Не ждать финала обоих раундов (в отличие от LOG-collector).

## Команда (plaza)

```bash
cd /var/www/bb-squad-platform
python3 scripts/canon_publish_match.py \
  --root /var/www/bb-squad-platform/data/kv-cache/data \
  --kind CW --id <legacyId> --month YYYY-MM --source SCREENSHOT
```

TRAIN: `--kind TRAIN` + id из `training/YYYY-MM.json`.

## Модули

- `scripts/canon_match_write.py` → `publish_match_from_kv`
- `scripts/canon_publish_match.py` — CLI
- Skill `screenshot-match-intake` — шаг «canon publish» обязателен после JSON

Сайт уже читает канон (фаза 3) → после publish модалка/месяц подхватывают overlay.
