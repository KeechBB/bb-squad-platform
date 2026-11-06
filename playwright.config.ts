import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.SMOKE_BASE_URL || "https://bb-squad.ru";
const authFile = "qa/auth/storage.json";
const hasAuth = existsSync(authFile);

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ["list"],
    ["json", { outputFile: "qa/last-results.json" }],
  ],
  use: {
    baseURL,
    trace: "off",
    screenshot: "only-on-failure",
    video: "off",
    ...devices["Desktop Chrome"],
  },
  outputDir: "qa/test-results",
  projects: [
    {
      name: "smoke",
      testMatch: /smoke\.spec\.ts/,
    },
    {
      name: "auth",
      testMatch: /absence\.auth\.spec\.ts/,
      // без файла — спека сама test.skip; project всё равно регистрируем
      use: hasAuth ? { storageState: authFile } : {},
    },
  ],
});
