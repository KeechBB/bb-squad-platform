# Telegram relay для recruit-bot на Plaza

Провайдер Plaza режет `api.telegram.org`. Бот ходит в Telegram через **Cloudflare Worker** `bb-squad-alert` (Workers Paid).

```
TELEGRAM_API_BASE=https://bb-squad-alert.…/s/SECRET/bot
POLL_SEC=120
GAP_ALERT_SEC=3600
```

Код Worker: `platform/scripts/cf-bb-tg-relay-worker.js`.
