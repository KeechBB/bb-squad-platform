/** PM2 prod — plaza (62GB / 20 threads). Не 4GB-эпоха: нужен cluster. */
module.exports = {
  apps: [
    {
      name: "bb-squad",
      cwd: "/var/www/bb-squad-platform",
      script: "node_modules/next/dist/bin/next",
      args: "start",
      interpreter: "node",
      interpreter_args: "--dns-result-order=ipv4first",
      // Было 4×cluster до деплоя с fork/1 (старый ecosystem под 4GB) — вернули.
      instances: 4,
      exec_mode: "cluster",
      env: {
        NODE_ENV: "production",
        NODE_OPTIONS: "--max-old-space-size=2048",
      },
      max_memory_restart: "2300M",
      exp_backoff_restart_delay: 2000,
      kill_timeout: 8000,
      listen_timeout: 15000,
    },
  ],
};
