# Phase 0 — Inventory (plaza)

Generated: `2026-10-25T22:17:42.419293+00:00`  
Backup latest: `/var/backups/bb-plaza/2026-10-26_0112` (~292 MB)  
JSON: `/var/backups/bb-plaza/phase0-inventory.json` · local `D:\BlackBerry\backups\bb-plaza_2026-10-26_0112\`

**Принято до старта:** советы по упрощению плана (один канон, `match_id`, матч сразу / явка :00 МСК, verifier-ворота, GitHub cold-only, Hunt отдельно, ORR/FIT не мигрировать в UI).  
**Обязательно позже:** текущие данные сайта (JSON kv-cache + ledgers) **разложить в одну БД plaza** — не удалять файлы до проверки импорта.

## Sizes

- **kv-cache**: 620M
- **data/public**: 1.1G
- **blackberry-kv**: 226M
- **bb-squad-logs**: 937M

## Training months (kv-cache)

- `2026-09.json` → 32 matches
- `2026-10.json` → 75 matches

## CW months (kv-cache)

- `2026-09.json` → 20 matches
- `2026-10.json` → 44 matches
- `2026-11.json` → 1 matches

- training players JSON: **121**
- CW players JSON: **45**

## Postgres tables

- `ActionLog`
- `Clan`
- `ClanCalendarEvent`
- `ClanInvite`
- `ClanJoinRequest`
- `ClanMember`
- `ClanPendingMember`
- `ClanSquad`
- `ClanSquadMember`
- `ClanTitle`
- `CwChallenge`
- `DayOffStint`
- `MapPin`
- `PublicMatch`
- `ReactionChatMessage`
- `ReactionPresence`
- `ReactionRun`
- `ReserveStint`
- `SiteNoticeState`
- `SitePageVisit`
- `SiteVisitor`
- `SquadEosSteamMap`
- `SquadHitEvent`
- `SquadLogBackfillJob`
- `SquadRoleEvent`
- `SquadServerSession`
- `SupportMessage`
- `SupportTicket`
- `TierChangeLog`
- `TournamentEntry`
- `TournamentEntryPlayer`
- `TournamentTeam`
- `TournamentTeamInvite`
- `TournamentTeamMember`
- `TournamentTeamVote`
- `TrainingMatchVote`
- `User`
- `UserNotice`

## PM2

- **bb-squad-collector**: online · `/var/www/bb-squad-platform/scripts/squad_log_collector.py`
- **bb-squad-staging**: online · `/var/www/bb-squad-platform-staging/node_modules/next/dist/bin/next`
- **bb-squad-siphon**: online · `/var/www/bb-squad-platform/scripts/squad_log_archive.py`
- **bb-squad**: online · `/var/www/bb-squad-platform/node_modules/next/dist/bin/next`
- **bb-squad**: online · `/var/www/bb-squad-platform/node_modules/next/dist/bin/next`
- **bb-squad**: online · `/var/www/bb-squad-platform/node_modules/next/dist/bin/next`
- **bb-squad**: online · `/var/www/bb-squad-platform/node_modules/next/dist/bin/next`

## Cron (root)

```
* * * * * cd /var/www/bb-squad-platform && /usr/bin/node scripts/sys-load-sample.mjs >> /var/log/bb-sys-load.log 2>&1
```

## match_id draft

`{YYYY-MM-DD}_{server}_{mapStem}_{HHMM}`
Example: `2026-10-25_tr1_cslmutaha_2329`

## Writers map (who writes where NOW)

| Writer | Process | Destinations today | Notes vs target canon |
|--------|---------|----------------------|------------------------|
| **Siphon** | `bb-squad-siphon` → `scripts/squad_log_archive.py` | архив логов (см. скрипт); live TR*/PB1 under `/var/www/bb-squad-logs/{TR1..TR5,PB1}` | Цель: вырезка `YYYY/MM/DD/<match_id>/` + Telegram |
| **Collector** | `bb-squad-collector` → `squad_log_collector.py` | ingest API → Postgres (`SquadServerSession`, hits, roles, `PublicMatch`); `sync_train` / `sync_kv_cw` → **kv-cache** JSON; RP rebuild | Сейчас может писать в kv-cache mid-pipeline; цель — канон БД после конца матча |
| **Next API** | `bb-squad` | Postgres: notices, journals (`ActionLog`), visits, clans, challenges, admin | Уже LIVE в БД plaza — оставить |
| **Hunt** | `keech_hunt_tracker.py` + Admin Hunt | live для Keech | Единственный LIVE из логов |
| **Deploy / sync_kv_cache** | `deploy.sh` | зеркало UI + merge training | Не должен жмать месяцы/ledger (shrink-guard есть частично) |
| **Cron** | root crontab | только `sys-load-sample.mjs` раз в минуту | Посещения :00 МСК — **ещё нет** отдельного hourly job |
| **Screenshot intake** | агент / skill | KV JSON + иногда platform | Цель: тот же канон БД, `source=screenshot` |

### Attendance (посещения) — сейчас

- Сессии с серверов → collector → `/api/ingest/squad-sessions` → **`SquadServerSession`** (Postgres).
- UI: admin attendance + home streaks (`/api/home-attendance-streaks`, `/api/admin/attendance*`) читают БД **сразу** (фактически live/near-live).
- **Цель:** копить в БД; **публичный раздел посещений ТМ** обновлять **раз в час :00 МСК**.

## Raw logs on disk

`/var/www/bb-squad-logs/`: **PB1, TR1, TR2, TR3, TR4, TR5** (~937 MB total).

## Key file sizes (kv-cache / public)

| File | Size |
|------|------|
| `data/public/rp-ledger.json` | ~434 MB |
| `data/public/rp-ladder.json` | ~10 MB |
| `kv-cache/.../training/rp-ledger.json` | ~15 MB |
| `tfs-fit.json` / `orr.json` | archive-only (UI removed) |

## Migration reminder

Current site data (kv-cache JSON, RP ledgers, players, public ledgers) **must** be imported into the single plaza DB in later phases. Do not delete legacy files until import verified (count ≥ before).

## Entity map (current → target)

| Entity | Now | Target (later) |
|--------|-----|----------------|
| Train/CW match facts | `kv-cache/data/training\|YYYY-MM.json` + players JSON | **Postgres** match tables (+ optional JSON projection) |
| Train/CW player per-match stats | `.../players/*.json` | **Postgres** |
| Train RP | `training/rp-ledger.json` + ladder | **Postgres** (file = projection ok) |
| Public RP / history | `data/public/*.json` + `PublicMatch` | **Postgres** primary |
| Accounts, clans, notices, journals | Postgres already | stay Postgres |
| Attendance / visits | `SquadServerSession` + admin APIs (live read) | Postgres; **site publish hourly MSK** |
| Raw logs | `/var/www/bb-squad-logs/TR*` | Siphon `YYYY/MM/DD/<match_id>/` |
| Hunt live | `keech_hunt_tracker` + admin | stay live; **not** site match canon |
| ORR/FIT JSON | `orr.json` / `tfs-fit.json` | **archive only** (не тащить в новую схему UI) |

## Phase 0 exit criteria — DONE when

- [x] Full backup on plaza + local pointer
- [x] Inventory JSON + this doc
- [x] Writers map
- [x] `match_id` draft accepted for Phase 1+
- [ ] Capitan ACK → Phase 1 (canon schema + import plan)

