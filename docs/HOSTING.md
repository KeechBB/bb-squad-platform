# Хостинг платформы (plaza)

Vercel не используем (SMS). Сайт и **Postgres** только на **plaza**. Старый Timeweb не используется.

| | |
|--|--|
| Прод (plaza) | **`178.72.181.111`** · hostname `bb-plaza` |
| SSH прод | `ssh -i ~/.ssh/bb_vps_ed25519 root@178.72.181.111` |
| Код / PM2 | `/var/www/bb-squad-platform` · `bb-squad` (**4×cluster**) · collector `bb-squad-collector` |
| БД | Postgres localhost `bb_squad` |
| Репо | https://github.com/KeechBB/bb-squad-platform |
| Бэкап кода на ПК | `D:\BlackBerry\backups\` — `bb-squad-platform_2026-09-25_1853.zip` (+ `.env`) |

Сайт: **https://bb-squad.ru** · КВ: **https://kv.bb-squad.ru/** · staging: **https://staging.bb-squad.ru**  
Деплой: `cd /var/www/bb-squad-platform && git pull && bash scripts/deploy.sh`

### DNS (Reg.ru) — только plaza

| Имя | A | TTL |
|--|--|--|
| `@` | `178.72.181.111` | **300** |
| `www` | `178.72.181.111` | **300** |
| `staging` | `178.72.181.111` | **300** |
| `kv` | CNAME → `keechbb.github.io.` | 300 |

Проверка авторитета (с любого Linux/`dig`):

```bash
dig +norecurse A bb-squad.ru @ns1.reg.ru
# → 178.72.181.111
```

Если `nslookup` / Google / Cloudflare ещё показывают старый IP — это **кэш резолверов** (раньше TTL был 86400). Зона на plaza уже; кэш сам истечёт. Для своего ПК сразу: строка в `hosts` → `178.72.181.111 bb-squad.ru www.bb-squad.ru`, затем `ipconfig /flushdns`.

## База данных (Postgres localhost)

- Слушает только localhost — **не** открывать `5432` в firewall.
- `DATABASE_URL` в `/var/www/bb-squad-platform/.env` → `postgresql://bb_squad:…@127.0.0.1:5432/bb_squad`
- Ежедневный бэкап **БД**: `scripts/backup-db.sh` → `/var/backups/bb-squad/` (**00:00 МСК**, хранит **5** последних).
- Ежедневный **полный** бэкап: `scripts/backup-full.sh` → `/var/backups/bb-squad-full/*.tar.gz` (**00:15 МСК**, хранит **5**).
  Откат: `bash scripts/restore-full.sh /var/backups/bb-squad-full/bb-squad-full_….tar.gz`
- Cron БД: `/etc/cron.d/bb-squad-db` · полный: `/etc/cron.d/bb-squad-full` (`CRON_TZ=Europe/Moscow`).

С ПК к прод-БД: SSH-туннель на plaza  
`ssh -i ~/.ssh/bb_vps_ed25519 -L 5432:127.0.0.1:5432 root@178.72.181.111`

## Обновление кода (деплой)

Агент с ПК → SSH на **plaza** (`root@178.72.181.111`) и деплой.

Деплой с ПК: `pwsh scripts/deploy-prod.ps1`  
Проверка: `bash scripts/verify-deploy.sh` (с ПК) или на VPS `bash scripts/verify-deploy.sh --local --sha <commit>`.

### Прод

После `git push` на `main`:

```bash
cd /var/www/bb-squad-platform && git pull && bash scripts/deploy.sh
```

Во время деплоя — заглушка `public/maintenance.html` (флаг `maintenance.on`).  
Nginx отдаёт её на **502/503/504**.

### Staging

| | |
|--|--|
| URL | **https://staging.bb-squad.ru** |
| Код | `/var/www/bb-squad-platform-staging` |
| Ветка | `staging` |
| PM2 | `bb-squad-staging` → порт **3001** |
| БД | Postgres `bb_squad_staging` |
| DNS | A `staging` → `178.72.181.111` |

**Первый раз:**

```bash
cd /var/www/bb-squad-platform && git pull && bash scripts/bootstrap-staging.sh
```

**Обычный цикл:** правки → push `staging` → на plaza `cd /var/www/bb-squad-platform-staging && git pull && bash scripts/deploy-staging.sh`
