# BBHitZoneLogger — зоны попаданий → SquadGame.log (TR1)

## Зачем

Ванильный лог Squad пишет `ActualDamage=… caused by Weapon_C` **без** кости/зоны.
Проверено на TR1 (2026-09-25): в `SquadGame.log` + backups нет `HitZone`/`BoneName` по хитам;
каталога `Saved/ModLoader` нет; Workshop-моды (OSI/OOTB) зоны тоже не логируют.

Этот мод в момент попадания пишет строку `BBHitZone:…`, которую читает
[`scripts/squad_log_collector.py`](../../scripts/squad_log_collector.py).

## Формат строки (контракт — не ломать)

```
BBHitZone: AttackerEOS=<32hex> AttackerSteam=<7656…|none> VictimEOS=<32hex|none> Zone=Head|Torso|Limb Damage=<float> Bone=<name> Weapon=<class> Server=TR1
```

Пример:

```
[2026.09.25-21.05.01:123][100]LogTemp: BBHitZone: AttackerEOS=0002ad07894544cbaf5527adf7cd8944 AttackerSteam=76561198957550201 VictimEOS=abc… Zone=Head Damage=120.0 Bone=head Damage=120.000000 Weapon=BP_QBZ192_Holo_C Server=TR1
```

Префикс `BBHitZone:` обязателен (коллектор грепает по нему).

## Маппинг кости → зона

| Zone  | кости (подстрока, lower-case) |
|-------|-------------------------------|
| Head  | `head`, `neck`, `helmet` |
| Torso | `spine`, `pelvis`, `clavicle`, `chest`, `hip`, `abdomen`, `thorax` |
| Limb  | всё остальное (`arm`, `hand`, `leg`, `foot`, `thigh`, `calf`, …) |

См. `Source/BBHitZoneLogger/BoneZones.h`.

## Сборка (нужен Squad Mod / ModLoader SDK)

1. Поставить **Squad Dedicated Server** + ModLoader / официальный пайплайн Workshop-модов (как OSI_Test в `Plugins/Mods/`).
2. Скопировать этот каталог в проект мода / ModLoader plugin.
3. Собрать **LinuxServer** pak (TR1 на Linux).
4. Выложить в `/home/squad/servers/TR1/SquadGame/Plugins/Mods/<workshopId>/` по аналогии с OSI_Test.
5. Включить мод в конфиге сервера TR1, **рестарт только TR1** (не пабы).
6. На тренировке убедиться: `grep BBHitZone …/SquadGame.log | tail`.

Исходники в `Source/` — ориентир под UE5+Squad; без SDK с ПК разработки бинарь не собрать.
После установки мода на TR1 платформа уже готова принимать события.

## Тест пайплайна без мода

```bash
# с машины коллектора / VPS:
python scripts/_tmp_emit_hitzone_sample.py   # шлёт 3 тестовых хита в ingest
```

Или вручную дописать строку `BBHitZone:…` в лог — коллектор подхватит на следующем poll.

## Связанное

- Ingest: `POST /api/ingest/squad-hitzones`
- UI: блок «Попадания» в профиле (тренировки)
- Док проверки: этот README + `docs/HITZONE.md`
