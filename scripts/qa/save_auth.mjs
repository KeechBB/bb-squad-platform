/**
 * Один раз: открывает браузер → логин Steam → сохраняет cookies для автотестов.
 * Usage: npm run test:auth:save
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const out = join(root, "qa", "auth", "storage.json");
const baseURL = process.env.SMOKE_BASE_URL || "https://bb-squad.ru";

mkdirSync(dirname(out), { recursive: true });

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();

console.log(`Открыл ${baseURL}/profile`);
console.log("Войди через Steam (полный профиль). Жду, пока /api/profile/shell станет 200…");
await page.goto(`${baseURL}/profile`, { waitUntil: "domcontentloaded" });

const deadline = Date.now() + 5 * 60 * 1000;
while (Date.now() < deadline) {
  const res = await context.request.get(`${baseURL}/api/profile/shell`);
  if (res.ok()) {
    const data = await res.json().catch(() => ({}));
    await context.storageState({ path: out });
    console.log(`OK: сессия сохранена → qa/auth/storage.json`);
    console.log(`Игрок: ${data?.me?.nick || data?.nick || "?"}`);
    await browser.close();
    process.exit(0);
  }
  await page.waitForTimeout(1500);
}

console.error("Таймаут 5 мин — сессия не поймана. Повтори npm run test:auth:save");
await browser.close();
process.exit(1);
