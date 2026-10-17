# BB Replay (свой стек)

## Актуальный путь (2026-10-18)

1. **Capture:** TR1 `/opt/bb-demo/` — `AdminDemoRec` после travel, стоп на следующем travel → `Saved/Demos/*.replay`
2. **Parse:** plaza `/opt/bb-replay/` — Codycody31 `squadreplay` → archive + slim `viewer.json`
3. **UI:** bb-squad.ru `/replays` + `/replays/[id]` — canvas поверх `public/replay-maps/`

Семпл в репо: `platform/data/replays/bb_20261018_003012_Narva_AAS_v1.json`.

Старый memory-reader вендор (`.sqrx`) остаётся в **`Новый Проект Кича/bb-replay/`** как запасной путь / референс — не использовать для UI.

Связанные доки: `LIVEMAP-MOD-SPEC.md` (координаты world UU). Правило хоста: `.cursor/rules/squad-game-host.mdc`.

**Запрещено:** строить UI/архив на iframe или API squadreader.com.
