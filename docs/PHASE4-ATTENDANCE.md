# Фаза 4 — явка на сайт раз в час (:00 МСК)

**Дата:** 2026-10-26  
**Статус:** публичная явка заморожена в snapshot; админка — live из Postgres.

## Канон

| Зона | Режим |
|------|--------|
| Главная · топ стриков | `data/cache/attendance-published.json` |
| Профиль · календарь ТМ | сессии обрезаны до начала текущего часа МСК |
| Админ → Посещения | live `buildAttendanceStreakBoard()` |
| Ingest логов | без изменений (сырьё в `SquadServerSession`) |

## Publish

- Cron: `/etc/cron.d/bb-attendance-hourly` · `CRON_TZ=Europe/Moscow` · `0 * * * *`
- Скрипт: `scripts/publish_attendance_hourly.sh` → `POST /api/cron/attendance-publish`
- Модуль: `src/lib/attendancePublish.ts`

Ответ главной: заголовок `X-Attendance-Publish: hourly-msk`.

## Не фаза 4

- Screenshot → CanonMatch  
- Siphon / verifier  
