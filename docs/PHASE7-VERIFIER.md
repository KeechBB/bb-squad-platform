# Фаза 7 — verifier (скрин/канон ↔ siphon-лог)

**Дата:** 2026-10-26  
**Статус:** CLI + авто после publish/slice. Ворота на сайт выключены по умолчанию.

## Что делает

Сравнивает киллы игроков из `CanonMatchPlayer` с парсом `matches/…/layer.log` (или source.ref).

| status | смысл |
|--------|--------|
| `pass` | overlap ников ≥45% и мало расхождений по kills → `verifiedAt` |
| `fail` | сильный разъезд → `verifiedAt=null`, отчёт на диск |
| `skip_no_log` | нет среза (чужой сервер) — ок для SCREENSHOT off-TR |
| `skip_thin` | пустая стата |

Отчёты: `data/cache/verify/<matchKey>.json` + `…/matches/…/verify.json`.

## CLI

```bash
python3 scripts/canon_verify_match.py --kind TRAIN --id 25-cslmutaha --month 2026-10
python3 scripts/canon_verify_match.py --pending
```

Авто: после `canon_publish_match.py`; после новых siphon-срезов.

## Ворота сайта

`BB_VERIFIER_GATE=1` — overlay пропускает SCREENSHOT без `verifiedAt` (остаётся disk).  
Дефолт `0` — не прячем матчи.
