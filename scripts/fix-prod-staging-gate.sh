#!/usr/bin/env bash
# Emergency: bb-squad.ru shows staging password wall.
# Paste in Timeweb VPS console as root.
set -euo pipefail

PROD=/var/www/bb-squad-platform
echo "==> $(date -Is) fix prod staging-gate leak"

cd "$PROD"
git fetch origin main
git reset --hard origin/main

# Strip gate flags from PROD .env (keep staging copy alone)
if [[ -f .env ]]; then
  cp -a .env ".env.bak-gate-$(date +%H%M%S)"
  sed -i '/^STAGING_GATE_ENABLED=/d' .env
  sed -i '/^STAGING_GATE_PASSWORD=/d' .env
  sed -i '/^STAGING_GATE_SECRET=/d' .env
  # ensure NEXTAUTH_URL is production
  if grep -q '^NEXTAUTH_URL=' .env; then
    sed -i 's|^NEXTAUTH_URL=.*|NEXTAUTH_URL=https://bb-squad.ru|' .env
  else
    echo 'NEXTAUTH_URL=https://bb-squad.ru' >> .env
  fi
  echo "==> prod .env gate flags removed"
  grep -E '^(STAGING_GATE|NEXTAUTH_URL|PORT)=' .env || true
fi

# nginx must point bb-squad.ru → :3000 (prod), not :3001
if [[ -f /etc/nginx/sites-available/bb-squad ]]; then
  if grep -q '127.0.0.1:3001' /etc/nginx/sites-available/bb-squad; then
    echo "==> FIX nginx: was proxying to :3001 (staging!)"
    sed -i 's/127.0.0.1:3001/127.0.0.1:3000/g' /etc/nginx/sites-available/bb-squad
  fi
  # refresh our conf (server_name bb-squad.ru only)
  if [[ -f "$PROD/deploy/nginx-bb-squad.conf" ]]; then
    # keep certbot ssl includes if present — only patch proxy if custom
    grep -n 'proxy_pass\|server_name' /etc/nginx/sites-available/bb-squad | head -n 20
  fi
  nginx -t && systemctl reload nginx || true
fi

echo "==> pm2 show"
pm2 describe bb-squad 2>/dev/null | grep -E 'status|script path|exec cwd|PORT|env' | head -n 30 || true

# Rebuild+restart prod so middleware host-guard is live
bash "$PROD/scripts/deploy.sh"

echo "==> verify"
curl -sI -H 'Host: bb-squad.ru' http://127.0.0.1:3000/ | head -n 15 || true
curl -sL -H 'Host: bb-squad.ru' http://127.0.0.1:3000/ | head -c 400 || true
echo
echo "==> DONE — open https://bb-squad.ru (hard refresh). Gate must NOT appear."
