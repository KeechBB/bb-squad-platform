# Battle Pass Season 2 — LIVE

**Статус:** Season 2 Halloween **включён** на `/battle-pass` с **04.11.2026**.

## Ссылки

- Живой BP: https://bb-squad.ru/battle-pass
- Превью (Keech): https://bb-squad.ru/battle-pass/halloween-preview
- Код UI: `src/components/Season2BattlePass.tsx` + `.bp-s2-*` в `globals.css`
- Награды / уровни / арт: `src/lib/battlePassSeason2.ts`, ассеты `/public/bp-halloween/`
- Скор: `scripts/build_battle_pass.py` · `seasonId=hw2-2026-11`
- Архив S1: `data/public/battle-pass-s1.json`

## Календарь (МСК)

| Этап | Даты |
|------|------|
| Season 1 «Фруктовый Сад» | до **31.10.2026** (архив) |
| Пауза | **01.11–03.11.2026** |
| Season 2 Halloween live | **04.11.2026 — 30.11.2026** |

## Запуск (сделано 04.11)

1. `/battle-pass` → `layout="season2"` + реальные данные.
2. Скорер S2: 25 уровней, cutover = последний матч ledger на момент включения.
3. S1 спрятан (архив JSON); медали S1 на полке читаются из `battle-pass-s1.json`.
