/**
 * Прогон Playwright smoke → JSON → PNG-карточка для чата Cursor.
 * Usage: node scripts/qa/run_smoke.mjs
 * Env: SMOKE_BASE_URL (default https://bb-squad.ru)
 */
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
mkdirSync(join(root, "qa"), { recursive: true });

const env = {
  ...process.env,
  SMOKE_BASE_URL: process.env.SMOKE_BASE_URL || "https://bb-squad.ru",
};

console.log(`smoke → ${env.SMOKE_BASE_URL}`);

const pw = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["playwright", "test", "--config=playwright.config.ts"],
  { cwd: root, env, stdio: "inherit", shell: process.platform === "win32" }
);

const py = spawnSync("python", ["scripts/qa/render_smoke_report.py"], {
  cwd: root,
  stdio: "inherit",
});

const code = pw.status === 0 && py.status === 0 ? 0 : pw.status || py.status || 1;
process.exit(code);
