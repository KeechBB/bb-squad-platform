# Архив логов Squad (навсегда)

## Зачем

Сегодня умеем парсить не всё. Через месяц/год можно вытащить из истории то,
чего сейчас нет в сайте — **если сырые логи не потерялись**.

Игровой хост ротирует `SquadGame-backup-*.log`. Этот архив на plaza (≈1.7 ТБ свободно)
хранит **все** копии по серверам.

## Что сделано

| | |
|--|--|
| Скрипт | `scripts/squad_log_archive.py` |
| PM2 | `bb-squad-siphon` |
| Корень | `/var/www/bb-squad-logs` (`BB_LOG_ARCHIVE_ROOT`) |
| Установка | `bash scripts/install-log-archive-on-vps.sh` |

Структура:

```text
/var/www/bb-squad-logs/
  PB1/                 ← remote TPUB1
  TR1/ … TR5/
    2026-10/
      SquadGame-backup-….log
      SquadGame-backup-….log.gz   ← старше ~14 дней
    _live/
      SquadGame.log               ← зеркало текущего
    _state.json
```

- Backup'ы **append-only** (не перезаписываем при том же size).
- Live зеркало обновляется.
- Старое сжимается в `.gz`.

## Коллектор сайта — что меняется само

| Поток | Откуда | Меняли? |
|-------|--------|---------|
| Join/leave, hits (реалтайм) | SSH tail `bb-squad-collector` | **Нет** — иначе лаг |
| Train / CW digitize, RP, поиск логов | `bb_log_fleet` + кэш + **архив** | **Да** — архив в `all_search_dirs` |

То есть: **живые события на сайт как раньше**; **история/перепарс — из архива без отдельной просьбы**.

## Серверы

По умолчанию: `TR1,TR2,TR3,TR4,TR5,PB1` (+ discover на хосте).  
Папка **PB1** = remote **TPUB1**.

## Команды

```bash
# установка / обновление
cd /var/www/bb-squad-platform && git pull
bash scripts/install-log-archive-on-vps.sh

# разовый полный проход
cd scripts && .venv-collector/bin/python squad_log_archive.py --once --full

pm2 logs bb-squad-siphon --lines 40
du -sh /var/www/bb-squad-logs/*
```
