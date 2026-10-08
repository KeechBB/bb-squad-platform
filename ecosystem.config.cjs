/** PM2 prod: лимит кучи + рестарт до OOM (VPS 4GB). */
module.exports = {
  apps: [
    {
      name: "bb-squad",
      cwd: "/var/www/bb-squad-platform",
      script: "node_modules/next/dist/bin/next",
      args: "start",
      interpreter: "node",
      interpreter_args: "--dns-result-order=ipv4first",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        // ~1.25GiB кучи: на 4GB VPS вместе с collector иначе Next съедает RAM и падает
        NODE_OPTIONS: "--max-old-space-size=1280",
      },
      max_memory_restart: "1450M",
      exp_backoff_restart_delay: 2000,
      kill_timeout: 8000,
      listen_timeout: 15000,
    },
  ],
};
