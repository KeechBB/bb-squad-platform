#!/bin/bash
LOG=/var/log/bb-recruit-cf-watch.log
cf_code=$(curl -sS -o /tmp/rel_cf.txt -w '%{http_code}' --max-time 10 https://bb-squad-alert.lgsghla.workers.dev/ || echo 000)
echo "$(date -u +%FT%TZ) cf=$cf_code" >>"$LOG"
if [ "$cf_code" != "200" ]; then
  exit 0
fi
status=$(pm2 jlist 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(next((p['pm2_env']['status'] for p in d if p['name']=='bb-recruit-bot'),'missing'))" 2>/dev/null || echo missing)
if [ "$status" = "online" ]; then
  exit 0
fi
pm2 start bb-recruit-bot --update-env >>"$LOG" 2>&1
echo "$(date -u +%FT%TZ) started bb-recruit-bot (cf=$cf_code)" >>"$LOG"
