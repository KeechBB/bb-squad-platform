# Фаза 6 — siphon: срезы по matchKey

**Дата:** 2026-10-26  
**Статус:** после каждого прохода `squad_log_archive` — папки закрытых слоёв.

## Layout

```
/var/www/bb-squad-logs/matches/YYYY/MM/DD/<matchKey>/
  meta.json      # server, map, start/end, sourceLog, extractedLines
  layer.log      # вырезка по времени (если лог < 80MB)
  source.ref     # путь к полному backup / _live
```

`matchKey` = канон фазы 1: `2026-10-25_tr1_cslmutaha_2329`.

## Env

| Var | Default | |
|-----|---------|--|
| `BB_SIPHON_SLICE` | `1` | выключить = `0` |
| `BB_SIPHON_SLICE_LOOKBACK_H` | `48` | окно поиска |
| `BB_SIPHON_SLICE_TG` | off | Telegram при новых срезах |

Полные `TR*/YYYY-MM/*.log` **не удаляем** — срезы дополнение.

## Модули

- `scripts/siphon_slice_matches.py`
- хук в `squad_log_archive.run_once`
