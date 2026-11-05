/** Отдельный процесс. Не входит в ecosystem.config.cjs, коллектор не трогает. */
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
