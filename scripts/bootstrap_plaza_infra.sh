#!/usr/bin/env bash
# Prepare bb-plaza (178.72.181.111) for migrating bb-squad.ru from Timeweb VPS.
# Does NOT cut over DNS / SSL live traffic. Safe to re-run (idempotent-ish).
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
LOG=/var/log/bb-plaza-bootstrap.log
exec > >(tee -a "$LOG") 2>&1

echo "==> $(date -Is) bootstrap plaza infra start"

# --- packages base ---
apt-get update -qq
apt-get install -y -qq \
  curl ca-certificates gnupg lsb-release software-properties-common \
  ufw fail2ban htop unzip git build-essential \
  nginx certbot python3-certbot-nginx \
  python3-pip python3-venv \
  rsync jq

# --- swap 4G (plenty of RAM but Next build likes swap safety) ---
if ! swapon --show | grep -q .; then
  if [[ ! -f /swapfile ]]; then
    fallocate -l 4G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=4096
    chmod 600 /swapfile
    mkswap /swapfile
  fi
  swapon /swapfile || true
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# --- Node 20 (match prod) ---
if ! command -v node >/dev/null || [[ "$(node -v 2>/dev/null | tr -d v | cut -d. -f1)" != "20" ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi
npm install -g pm2@latest

# --- PostgreSQL 16 from PGDG (prod is 18; dump→16 OK for our schema; upgrade later if needed) ---
if ! command -v psql >/dev/null; then
  install -d /usr/share/postgresql-common/pgdg
  curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
    https://www.postgresql.org/media/keys/ACCC4CF8.asc
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list
  apt-get update -qq
  apt-get install -y -qq postgresql-16 postgresql-client-16
fi
systemctl enable --now postgresql

# DB role + databases (password stored only on server)
SECRET_FILE=/root/bb-plaza-secrets.env
if [[ ! -f "$SECRET_FILE" ]]; then
  DB_PASS="$(openssl rand -base64 24 | tr -d '/+=' | head -c 28)"
  cat >"$SECRET_FILE" <<EOF
# Generated $(date -Is) — do not commit
BB_PG_USER=bb_squad
BB_PG_PASS=${DB_PASS}
BB_PG_DB=bb_squad
BB_PG_STAGING_DB=bb_squad_staging
DATABASE_URL=postgresql://bb_squad:${DB_PASS}@127.0.0.1:5432/bb_squad
DATABASE_URL_STAGING=postgresql://bb_squad:${DB_PASS}@127.0.0.1:5432/bb_squad_staging
EOF
  chmod 600 "$SECRET_FILE"
fi
# shellcheck disable=SC1090
source "$SECRET_FILE"

sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${BB_PG_USER}') THEN
    CREATE ROLE ${BB_PG_USER} LOGIN PASSWORD '${BB_PG_PASS}';
  ELSE
    ALTER ROLE ${BB_PG_USER} WITH PASSWORD '${BB_PG_PASS}';
  END IF;
END
\$\$;
SELECT 'ok_role' AS status;
SQL

for db in "${BB_PG_DB}" "${BB_PG_STAGING_DB}"; do
  exists="$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${db}'")"
  if [[ "$exists" != "1" ]]; then
    sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${db} OWNER ${BB_PG_USER};"
  fi
done

# listen localhost only (default) — double-check
PG_CONF="$(ls /etc/postgresql/*/main/postgresql.conf | head -1)"
PG_HBA="$(ls /etc/postgresql/*/main/pg_hba.conf | head -1)"
sed -i "s/^#\\?listen_addresses.*/listen_addresses = 'localhost'/" "$PG_CONF"
systemctl reload postgresql || systemctl restart postgresql

# --- dirs ---
mkdir -p /var/www /var/backups/bb-squad /var/backups/bb-squad-full /var/log/bb-squad
mkdir -p /var/www/bb-squad-platform /var/www/blackberry-kv /var/www/bb-squad-platform-staging

# --- firewall ---
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
# Node/PM2 stay localhost-only via nginx; do NOT open 3000/5432 publicly
ufw --force enable

# --- nginx placeholder (HTTP only until DNS cutover + certbot) ---
cat >/etc/nginx/sites-available/bb-squad <<'NGX'
# PRE-CUTOVER: HTTP only. After DNS → 178.72.181.111 run:
#   certbot --nginx -d bb-squad.ru -d www.bb-squad.ru
# Full prod conf: deploy/nginx-bb-squad.conf (+ ssl from certbot)

server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name bb-squad.ru www.bb-squad.ru _;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    # Health probe before cutover
    location = /plaza-ready {
        default_type text/plain;
        return 200 "bb-plaza infra ready\n";
    }

    error_page 502 503 504 /maintenance.html;
    location = /maintenance.html {
        root /var/www/bb-squad-platform/public;
        default_type text/html;
        internal;
        add_header Cache-Control "no-store" always;
    }

    location ^~ /_next/static/ {
        alias /var/www/bb-squad-platform/.next/static/;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
        access_log off;
    }

    location ^~ /kv-static/ {
        alias /var/www/bb-squad-platform/data/kv-cache/;
        add_header Cache-Control "no-store, max-age=0, must-revalidate" always;
        try_files $uri $uri/ =404;
    }

    location / {
        if (-f /var/www/bb-squad-platform/maintenance.on) {
            return 503;
        }
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
        proxy_connect_timeout 5s;
        proxy_intercept_errors on;
    }
}
NGX

ln -sfn /etc/nginx/sites-available/bb-squad /etc/nginx/sites-enabled/bb-squad
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx
systemctl reload nginx

# --- pm2 startup (apps added after code sync) ---
pm2 startup systemd -u root --hp /root >/tmp/pm2-startup.txt 2>&1 || true
# parse and run the suggested systemctl command if present
if grep -q 'systemctl' /tmp/pm2-startup.txt; then
  eval "$(grep -oE 'sudo .*systemctl.*|systemctl .*' /tmp/pm2-startup.txt | head -1)" || true
fi

# --- marker ---
cat >/root/bb-plaza-READY.txt <<EOF
bb-plaza infrastructure prepared: $(date -Is)
hostname: $(hostname)
node: $(node -v)
npm: $(npm -v)
pm2: $(pm2 -v)
psql: $(psql --version)
nginx: $(nginx -v 2>&1)
ufw: 22,80,443
secrets: $SECRET_FILE
next: rsync/code clone + .env + db restore + DNS cutover
EOF

echo "==> $(date -Is) bootstrap plaza infra DONE"
cat /root/bb-plaza-READY.txt
curl -sS -o /dev/null -w "plaza-ready HTTP %{http_code}\n" http://127.0.0.1/plaza-ready || true
