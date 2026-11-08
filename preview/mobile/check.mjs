import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium, devices } from "@playwright/test";

const baseURL = `http://127.0.0.1:${process.env.PREVIEW_PORT || "3100"}`;
const screenshots = fileURLToPath(new URL("screenshots/", import.meta.url));
await mkdir(screenshots, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const [name, options] of [
    ["desktop", { viewport: { width: 1440, height: 1000 } }],
    ["phone", { ...devices["iPhone 13"], defaultBrowserType: undefined }],
  ]) {
    const context = await browser.newContext({ ...options, baseURL });
    const page = await context.newPage();
    const errors = [];
    const unknown = new Set();
    const external = new Set();
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (response.url().includes("/api/") && response.status() >= 400) unknown.add(`${response.status()} ${response.url()}`);
    });
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== baseURL) {
        external.add(url.origin);
        await route.abort();
      } else await route.continue();
    });
    for (const path of ["/", "/profile", "/public"]) {
      const response = await page.goto(path, { waitUntil: "networkidle" });
      assert.equal(response?.status(), 200, path);
      if (path === "/profile") await page.getByRole("button", { name: "Взять выходной", exact: true }).waitFor();
      await page.screenshot({ path: `${screenshots}/${name}-${path === "/" ? "home" : path.slice(1)}.png`, fullPage: true });
    }
    // Local API is explicitly read-only, including routes that would mutate production.
    const write = await context.request.post("/api/profile/day-off", { data: { until: "2099-01-01" } });
    assert.equal(write.status(), 405);
    await page.locator(".preview-toolbar summary").click();
    await page.getByLabel("Набор тестовых данных").selectOption("empty");
    await page.waitForLoadState("networkidle");
    assert.equal(await page.getByLabel("Набор тестовых данных").inputValue(), "empty");
    const emptyView = await context.request.get("/api/profile/view-data");
    assert.equal((await emptyView.json()).histories.trainTotal, 0);
    await page.goto("/profile", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Взять выходной", exact: true }).waitFor();
    await page.screenshot({ path: `${screenshots}/${name}-profile-empty.png`, fullPage: true });
    assert.deepEqual(errors, [], `${name}: browser runtime errors`);
    assert.deepEqual([...unknown], [], `${name}: missing initial API fixtures`);
    assert.deepEqual([...external], [], `${name}: unexpected external requests`);
    console.log(`${name}: home/profile/rating + empty profile + read-only API passed`);
    await context.close();
  }
} finally {
  await browser.close();
}
