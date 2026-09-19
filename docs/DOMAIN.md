# Домен без IP: bb-squad.ru → Timeweb

Цель:
- **https://bb-squad.ru** — платформа (вход / регистрация)
- **https://kv.bb-squad.ru** — таблица КВ
- Без `91.222.237.91:3000` в адресной строке

Сервер: `91.222.237.91` (Mysterious Lacerta).

---

## 1. DNS (сделай ты в панели домена)

Где покупал `bb-squad.ru` (Reg.ru / Timeweb Domains / Cloudflare и т.д.) → DNS-записи.

| Тип | Имя / хост | Значение |
|-----|------------|----------|
| **A** | `@` (или пусто / bb-squad.ru) | `91.222.237.91` |
| **A** | `www` | `91.222.237.91` |
| **CNAME** | `kv` | `keechbb.github.io` |

Удали старые CNAME/A на GitHub Pages для корня `@`, если мешают.

Подожди 5–60 минут. Проверка с ПК:

```text
ping bb-squad.ru
```

Должен показать `91.222.237.91`.

Напиши агенту: **«DNS готов»**.

---

## 2. На сервере (консоль Timeweb) — nginx

```bash
apt update && apt install -y nginx
cat > /etc/nginx/sites-available/bb-squad <<'EOF'
server {
    listen 80;
    server_name bb-squad.ru www.bb-squad.ru;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF
ln -sf /etc/nginx/sites-available/bb-squad /etc/nginx/sites-enabled/bb-squad
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

В Timeweb → сервер → **Сеть / файрвол**: открыть порты **80** и **443** (TCP).

Проверка: в браузере `http://bb-squad.ru` — должна открыться платформа.

---

## 3. HTTPS (Let's Encrypt)

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d bb-squad.ru -d www.bb-squad.ru
```

Следуй вопросам (email, согласие). Потом сайт: `https://bb-squad.ru`.

---

## 4. Обновить .env на сервере

```bash
cd /var/www/bb-squad-platform
nano .env
```

Поставь:

```env
NEXTAUTH_URL="https://bb-squad.ru"
```

(остальные строки не трогай)

```bash
pm2 restart bb-squad
```

---

## 5. Steam API

https://steamcommunity.com/dev/apikey → Domain Name: **`bb-squad.ru`** (без http).

---

## 6. Таблица КВ на kv.

Уже в репо CNAME = `kv.bb-squad.ru`. В GitHub → repo `blackberry-kv` → Settings → Pages → Custom domain: `kv.bb-squad.ru` → Save (галочка HTTPS когда появится).

Ссылка на КВ: https://kv.bb-squad.ru/

---

## Если что сломалось

- Сайт по IP запасной: `http://91.222.237.91:3000`
- `pm2 status` / `nginx -t` / `systemctl status nginx`
