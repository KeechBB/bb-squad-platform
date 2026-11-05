/** Отдельный процесс. Не входит в ecosystem.config.cjs, коллектор не трогает.
 *  На Plaza надёжный старт:
 *  pm2 start bot.py --name bb-recruit-bot \
 *    --interpreter /var/www/bb-squad-platform/recruit-bot/.venv/bin/python \
 *    --cwd /var/www/bb-squad-platform/recruit-bot
 */
module.exports = {
  apps: [
    {
      name: "bb-recruit-bot",
      cwd: "/var/www/bb-squad-platform/recruit-bot",
      script: "bot.py",
      interpreter: "/var/www/bb-squad-platform/recruit-bot/.venv/bin/python",
      autorestart: true,
      max_restarts: 20,
      exp_backoff_restart_delay: 2000,
    },
  ],
};
