import { spawn } from "node:child_process";
import { existsSync, symlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const directory = fileURLToPath(new URL(".", import.meta.url));
const root = path.resolve(directory, "../..");
const next = path.join(root, "node_modules/next/dist/bin/next");
if (!existsSync(next)) {
  console.error("Install the repository dependencies first: npm ci");
  process.exit(1);
}
const assets = path.join(directory, "public");
if (!existsSync(assets)) symlinkSync(path.join(root, "public"), assets, "dir");

// This is a separate Next application. It never loads the main application's
// middleware, API handlers, .env files, or Prisma client.
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: "1" };
for (const key of ["DATABASE_URL", "DIRECT_URL", "STEAM_API_KEY", "NEXTAUTH_SECRET", "NEXTAUTH_URL", "SQUAD_INGEST_SECRET"]) {
  delete env[key];
}
const child = spawn(process.execPath, [next, "dev", directory, "--hostname", "127.0.0.1", "--port", process.env.PREVIEW_PORT || "3100"], {
  cwd: directory,
  env,
  stdio: "inherit",
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
