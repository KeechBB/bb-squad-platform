#!/usr/bin/env bash
# One-shot: install agent SSH pubkey then run Neon→VPS migrate.
# Paste entire file into Timeweb VPS web console as root, OR:
#   curl -fsSL ... | bash
set -euo pipefail
PUB='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHdwkTHcfsDUqQsU1mR/PllWjUYvoZUX7y+/jqhCoTv/ cursor-bb-vps'
mkdir -p /root/.ssh
chmod 700 /root/.ssh
touch /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys
grep -qxF "$PUB" /root/.ssh/authorized_keys || echo "$PUB" >> /root/.ssh/authorized_keys
echo "KEY_OK"

APP=/var/www/bb-squad-platform
cd "$APP"
# pull script if missing (repo must already have it after push)
if [[ ! -f scripts/migrate-neon-to-vps.sh ]]; then
  git pull --ff-only || true
fi
if [[ -f scripts/migrate-neon-to-vps.sh ]]; then
  bash scripts/migrate-neon-to-vps.sh
else
  echo "Missing scripts/migrate-neon-to-vps.sh — push repo first, then re-run."
  exit 1
fi
