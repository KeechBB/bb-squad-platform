# BB Replay (свой стек)

## Пайплайн

1. **Capture:** TR1 `/opt/bb-demo/` — `AdminDemoRec` после travel → `Saved/Demos/*.replay`
2. **Parse:** plaza `/opt/bb-replay/` — `squadreplay` → archive + `viewer.json`
3. **UI:** `/replays` — canvas + реестр карт

## Система координат (канон)

| Что | Откуда | Единицы |
|-----|--------|---------|
| Позиции игроков | `.replay` → squadreplay `tracks.*.samples` | Unreal **cm** (UU) |
| Рамка карты | `data/replay-maps/registry.json` ← SquadCalc SDK corners | **метры** × 100 → UU |
| Текстура | `public/replay-maps/{Key}.png` из `AllMaps_Minimaps.zip` Vanilla | полный PNG, без пережатия |
| Caps / Main | `data/replay-maps/capzones.json` (статика слоя) | UU, те же axes |

Слой матча (`Narva_AAS_v1`) → `mapKey` через `layers[]` в реестре → картинка + bounds.

**Ось Y:** в Squad world Y растёт на **юг** (= вниз на текстуре). `flipY` должен быть **false** — иначе треки «не близко» к Main/флагам.

**Не смешивать** произвольные «красивые» карты 4098 с чужими углами — только пара *тот же минимап + те же corner0/corner1*. Flags/mains на Vanilla PNG обычно не нарисованы — их рисует оверлей из `capzones.json`.

### Добавить карту

1. Прописать в `data/replay-maps/registry.json` (bounds из SquadCalc + `packPath` + `layers`, `flipY: false`).
2. Вытащить PNG:

```bash
python scripts/sync_replay_minimaps.py "C:\Users\...\AllMaps_Minimaps.zip" --only Narva,Mutaha
```

3. Залить PNG на VPS (`public/replay-maps/`) — тяжёлые файлы **не** в git:

```bash
scp -i ~/.ssh/bb_vps_ed25519 public/replay-maps/*.png root@VPS:/var/www/bb-squad-platform/public/replay-maps/
```

Deploy сохраняет `public/replay-maps/` при pull.

FCL-слои с отдельным минимапом — отдельный `mapKey` (своя текстура; bounds пока те же, пока не подтверждены другие углы).

## Семпл

`data/replays/bb_20261018_003012_Narva_AAS_v1.json`

Старый memory-reader (`.sqrx`) в `Новый Проект Кича/bb-replay/` — запасной путь, не для UI.

**Запрещено:** iframe / API squadreader.com.
