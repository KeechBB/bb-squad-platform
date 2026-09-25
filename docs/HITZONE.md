# Hit-zone % (TR1)

Статус на **2026-09-25**:

| Проверка | Результат |
|----------|-----------|
| `ActualDamage` в backups TR1 | есть (ник, урон, EOS/steam, оружие) |
| Bone / HitZone / head_01 в логах хитов | **нет** |
| `Saved/ModLoader` | нет |
| `Plugins/Mods` | OSI_Test, OOTB, CAF — не пишут зоны |

**Вывод:** нужен мод [`mods/BBHitZoneLogger`](../mods/BBHitZoneLogger/README.md).  
Платформа уже парсит `BBHitZone:` → Neon → блок в профиле.

После установки мода на TR1: `grep BBHitZone …/SquadGame.log`.
