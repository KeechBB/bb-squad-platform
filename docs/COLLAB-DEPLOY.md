# Deployer: SSH без root (второй этап)

Когда помощнику нужен самостоятельный `git pull && build && pm2 restart` — **не** даём root и не даём панель Timeweb.

## На VPS (делает Кич под root)

```bash
# 1) пользователь
adduser --disabled-password deploy
usermod -aG www-data deploy   # при необходимости

# 2) каталог сайта — группа/права на запись для deploy
chown -R deploy:deploy /var/www/bb-squad-platform
# либо ACL: setfacl -R -m u:deploy:rwx /var/www/bb-squad-platform

# 3) SSH-ключ помощника
mkdir -p /home/deploy/.ssh
# вставить public key помощника в /home/deploy/.ssh/authorized_keys
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh

# 4) pm2 от имени deploy (или sudoers только на restart)
# Вариант A: pm2 уже под deploy после переноса процессов
# Вариант B: sudoers
cat >/etc/sudoers.d/bb-deploy <<'EOF'
deploy ALL=(root) NOPASSWD: /usr/bin/pm2 restart bb-squad, /usr/bin/pm2 status, /usr/bin/pm2 logs bb-squad *
EOF
chmod 440 /etc/sudoers.d/bb-deploy
```

## Что помощник НЕ получает

- пароль `root` / консоль Timeweb / биллинг
- `SQUAD_SSH_PASSWORD` / `.squad-collector.env`
- правку nginx/certbot без отдельной просьбы
- прод Neon connect string «на всякий случай» (если деплой только код — хватит VPS `.env`)

## Рабочий цикл Deployer

```bash
ssh deploy@91.222.237.91
cd /var/www/bb-squad-platform
git pull --ff-only
npm ci   # или npm install
npx prisma generate
npm run build
pm2 restart bb-squad   # или sudo pm2 restart bb-squad
```

Коллектор (`bb-squad-collector`) не трогать без Кича.
