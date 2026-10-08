#!/usr/bin/env bash
# Install health-watch cron + ensure relay env on platform .env for Next.js alerts.
set -euo pipefail
APP="${APP_DIR:-/var/www/bb-squad-platform}"
COL_ENV="$APP/scripts/.squad-collector.env"
PLAT_ENV="$APP/.env"

# Mirror TG relay keys into platform .env (for registration alerts from Next)
if [[ -f "$COL_ENV" ]]; then
  for key in BB_TG_RELAY_URL BB_TG_RELAY_SECRET BB_TG_CHAT_ID BB_TG_RP_LAG_MIN; do
    val="$(grep -E "^${key}=" "$COL_ENV" | head -1 | cut -d= -f2- || true)"
    if [[ -n "$val" ]]; then
      if grep -qE "^${key}=" "$PLAT_ENV" 2>/dev/null; then
        sed -i "s|^${key}=.*|${key}=${val}|" "$PLAT_ENV"
      else
        echo "${key}=${val}" >> "$PLAT_ENV"
      fi
    fi
  done
  echo "==> mirrored BB_TG_* into $PLAT_ENV"
fi

cat >/etc/cron.d/bb-squad-alerts <<'EOF'
CRON_TZ=Europe/Moscow
# сайт / pm2 / нагрузка / кеш — каждые 3 минуты
*/3 * * * * root cd /var/www/bb-squad-platform/scripts && /var/www/bb-squad-platform/scripts/.venv-collector/bin/python bb_health_watch.py >> /var/log/bb-squad-alerts.log 2>&1
EOF
chmod 644 /etc/cron.d/bb-squad-alerts
touch /var/log/bb-squad-alerts.log
chmod 644 /var/log/bb-squad-alerts.log
echo "==> cron installed: /etc/cron.d/bb-squad-alerts"
# smoke
cd "$APP/scripts" && .venv-collector/bin/python bb_health_watch.py || true
echo "done"
