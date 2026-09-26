# Вставь ЦЕЛИКОМ в Timeweb → VPS → Консоль (уже под root).
# После KEY_OK агент сможет добить миграцию по SSH.
# Либо этот блок сам догонит migrate после git pull.

mkdir -p /root/.ssh && chmod 700 /root/.ssh
touch /root/.ssh/authorized_keys && chmod 600 /root/.ssh/authorized_keys
grep -qxF 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHdwkTHcfsDUqQsU1mR/PllWjUYvoZUX7y+/jqhCoTv/ cursor-bb-vps' /root/.ssh/authorized_keys \
  || echo 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHdwkTHcfsDUqQsU1mR/PllWjUYvoZUX7y+/jqhCoTv/ cursor-bb-vps' >> /root/.ssh/authorized_keys
echo KEY_OK

cd /var/www/bb-squad-platform && git pull --ff-only
bash scripts/migrate-neon-to-vps.sh
