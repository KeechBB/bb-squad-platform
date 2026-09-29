# ТЗ: мод логирования зон попаданий (TR1 BlackBerry)

**Заказчик:** клан BlackBerry / сайт bb-squad.ru  
**Сервер:** только **TR1** (тренировка), Linux dedicated  
**Цель:** писать в `SquadGame.log` зону попадания (голова / тело / конечности), чтобы сайт считал % по игрокам.

---

## 1. Контекст

Ванильный лог Squad даёт строку вида:

`LogSquad: Player:Victim ActualDamage=42 from Attacker (Online IDs: EOS:… steam:…) caused by Weapon_C`

В ней **нет** кости/зоны. Нужен **ModLoader-мод** (как SquadJSLogger), который в момент хита дописывает свою строку.

Платформа (коллектор + профиль) будет парсить только строки с префиксом **`BBHitZone:`**.

---

## 2. Что сделать

1. Мод под **ModLoader** (зависимость — актуальный ModLoader для текущей версии Squad / UE5).
2. Хук на урон по солдату (damage / wound), доступ к **BoneName** / hit bone из HitResult (или аналог в API моддера).
3. Маппинг кости → одна из трёх зон (см. §4).
4. Запись в лог сервера строки фиксированного формата (§3).
5. Работа **только на TR1** (конфиг `Server=TR1` / enable-флаг; на пабы не ставим).
6. Сборка **LinuxServer** pak + краткая инструкция установки в `Plugins/Mods/`.

Не требуется: UI в игре, RCON, клиентский мод сверх требований ModLoader, accuracy (shots fired).

---

## 3. Формат строки лога (контракт — не менять без согласания)

Одна строка на попадание:

```
BBHitZone: AttackerEOS=<32hex|none> AttackerSteam=<7656…17digits|none> VictimEOS=<32hex|none> Zone=Head|Torso|Limb Damage=<float> Bone=<boneName> Weapon=<className> Server=TR1
```

**Пример:**

```
[2026.09.25-21.05.01:123][100]LogTemp: BBHitZone: AttackerEOS=0002ad07894544cbaf5527adf7cd8944 AttackerSteam=76561198957550201 VictimEOS=abcdef0123456789abcdef0123456789 Zone=Head Damage=120.000 Bone=head Weapon=BP_QBZ192_Holo_C Server=TR1
```

### Правила

| Поле | Обязательно | Примечание |
|------|-------------|------------|
| Префикс `BBHitZone:` | да | Ищем grep’ом; без него сайт не увидит |
| `AttackerEOS` | да | 32 hex или `none` |
| `AttackerSteam` | да | Steam64 `7656…` или `none` (если нет — `none`, EOS обязателен по возможности) |
| `VictimEOS` | да | 32 hex или `none` |
| `Zone` | да | Только `Head` / `Torso` / `Limb` (латиница, PascalCase) |
| `Damage` | да | float, точка |
| `Bone` | да | сырое имя кости UE, без пробелов (или `_`) |
| `Weapon` | да | class name / short name, без пробелов |
| `Server` | да | всегда `TR1` на нашем сервере |

- Не логировать хиты без атакующего (nullptr / self-damage — по желанию skip или `AttackerEOS=none`).
- Не раздувать лог: одна строка на hit; без JSON-простыней.
- Канал лога: обычный server log (`LogTemp` / аналог), чтобы попало в `SquadGame.log`.

---

## 4. Маппинг Bone → Zone

Сравнение **case-insensitive**, по подстроке в имени кости:

| Zone | Если в Bone есть |
|------|------------------|
| **Head** | `head`, `neck`, `helmet` |
| **Torso** | `spine`, `pelvis`, `clavicle`, `chest`, `hip`, `abdomen`, `thorax`, `ribcage` |
| **Limb** | всё остальное (`arm`, `hand`, `leg`, `foot`, `thigh`, `calf`, …) |

Если Bone пустой/unknown → **Limb** (или skip — согласовать; предпочтительно Limb).

---

## 5. Установка на наш TR1

Путь сервера (ориентир):

`/home/squad/servers/TR1/SquadGame/Plugins/Mods/<id>/`

Как у существующих модов (OSI_Test / OOTB): `info.json`, `.uplugin`, `Content/Paks/LinuxServer/*`.

Плюс: включение в списке модов TR1 + **рестарт только TR1**.

После установки проверка:

```bash
grep BBHitZone /home/squad/servers/TR1/SquadGame/Saved/Logs/SquadGame.log | tail -20
```

Ожидаем строки во время стрельбы на тренировке.

---

## 6. Приёмка

- [ ] ModLoader + мод на TR1, сервер стартует без крашей  
- [ ] При попаданиях в логе есть `BBHitZone:` с валидными Zone  
- [ ] Headshots стабильно дают `Zone=Head` (выборочный тест)  
- [ ] Попадания в руки/ноги → `Limb`, в корпус → `Torso`  
- [ ] На паб-серверы мод **не** включён  
- [ ] Нагрузка: без заметного FPS/lag на ~80 slot TR1 (PlayerDamaged часто — по возможности лёгкий лог)

---

## 7. Что не входит в ТЗ

- Парсер на сайте / БД / UI (делаем мы)  
- Сбор «выстрелы / точность» (shots) — в логах игры нет  
- Публикация в Workshop (по желанию; нам достаточно приватного pak + инструкция)

---

## 8. Контакты / артефакты на выходе

От моддера нужно:

1. Готовый LinuxServer пакет (или Workshop ID + зависимости)  
2. 5–10 скринов/кусков лога с `BBHitZone:`  
3. README: как включить на dedicated, версия Squad / ModLoader  

Вопросы по формату строки — до сборки, не после (парсер жёстко завязан на §3).
