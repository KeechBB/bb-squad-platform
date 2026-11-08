import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const baseURL = `http://127.0.0.1:${process.env.PREVIEW_PORT || "3100"}`;
const output = fileURLToPath(new URL("screenshots/", import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const failures = [];
try {
  for (const width of (process.env.CHECK_WIDTHS || "390,320,768,844,1440").split(",").map(Number)) {
    const context = await browser.newContext({ viewport: { width, height: width === 844 ? 390 : 900 }, isMobile: width < 1024, hasTouch: width < 1024, baseURL });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    const missing = new Set();
    page.on("pageerror", (err) => errors.push(`${new URL(page.url()).pathname}: ${err.message}`));
    page.on("response", (res) => { if (res.url().includes("/api/") && res.status() >= 500) missing.add(`${res.status()} ${new URL(res.url()).pathname}`); });
    await context.route("**/*", (route) => new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort());
    const routes = process.env.CHECK_ROUTES ? process.env.CHECK_ROUTES.split(",") : width === 390
      ? ["/", "/profile", "/public", "/clans", "/clans/preview-clan", "/factions/demo-vanguard", "/battle-pass", "/tournaments", "/tournaments/bracket", "/tournaments/bets", "/aim", "/register", "/clans/new", "/admin", "/cw", "/tm", "/cw-find", "/rating", "/tiers-fit", "/tm/sapper", "/admin/panelka", "/replays/preview"]
      : ["/", "/profile", "/public", "/factions/demo-vanguard", "/battle-pass", "/tournaments"];
    for (const path of routes) {
      try {
        const response = await page.goto(path, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
        assert.equal(response.status(), 200);
        if (path === "/profile") await page.getByRole("button", { name: "Взять выходной", exact: true }).waitFor();
        await page.evaluate(() => document.fonts.ready);
        if (width < 1024) {
          if (path === "/battle-pass") {
            assert.ok(await page.locator(".bp-s2-stage").evaluate((el) => el.clientWidth > document.documentElement.clientWidth * .75), "battle-pass task is squeezed into desktop grid tracks");
          }
          const metrics = await page.evaluate(() => {
            const width = document.documentElement.clientWidth;
            return {
              viewport: window.innerWidth,
              width, scroll: document.documentElement.scrollWidth,
              offenders: [...document.querySelectorAll("body *")].filter((el) => {
                const rect = el.getBoundingClientRect();
                return rect.width && rect.right > width + 2 && getComputedStyle(el).position !== "fixed" && !el.closest(".admin-table-wrap, .profile-hist-table-wrap, .tn-tabs, .public-rating-tabs, .faction-roster-fit, .faction-online-fit, .public-rp-scale-track, .bp-s2-track, .admin-tabs");
              }).slice(0, 8).map((el) => `${el.tagName}.${el.className}`),
            };
          });
          assert.ok(metrics.scroll <= metrics.width + 2, `page overflow: ${JSON.stringify(metrics)}`);
          assert.ok(Math.abs(metrics.viewport - width) < 2, "viewport changed after navigation");
        }
        assert.ok(await page.evaluate(() => document.documentElement.scrollHeight < 20000), "page grows without bounds");
        await page.screenshot({ path: `${output}/responsive-${width}-${path === "/" ? "home" : path.replaceAll("/", "-").slice(1)}.png`, fullPage: true, style: ".preview-toolbar{visibility:hidden}", timeout: 10000 });
        if (path === "/cw" || path === "/tm") {
          const doc = page.frameLocator("iframe");
          await doc.locator(".bb-mobile-table-scroll").waitFor();
          assert.ok(await doc.locator(".bb-mobile-table-scroll").evaluate((el) => el.scrollWidth > el.clientWidth));
        }
        console.log(`${width} ${path}: OK`);
      } catch (error) { failures.push(`${width} ${path}: ${error.message}`); console.log(`${width} ${path}: FAIL ${error.message}`); }
    }
    if (width === 390 && !process.env.CHECK_ROUTES) {
      await page.goto("/", { waitUntil: "networkidle" });
      const toggle = page.locator(".mobile-menu-toggle");
      await toggle.click();
      assert.equal(await toggle.getAttribute("aria-expanded"), "true");
      await page.getByRole("button", { name: "Кланы", exact: false }).first().click();
      await page.getByRole("menuitem", { name: "Список кланов" }).click();
      await page.waitForURL("**/clans");
      assert.equal(await toggle.getAttribute("aria-expanded"), "false");
      await toggle.click(); await page.keyboard.press("Escape");
      assert.equal(await toggle.getAttribute("aria-expanded"), "false");
      await toggle.click();
      await page.locator(".mobile-nav-search input").fill("Demo");
      await page.locator(".mobile-nav-search .player-search-item").first().click();
      await page.waitForURL("**/players/**");
      assert.equal(await toggle.getAttribute("aria-expanded"), "false");
      await page.goto("/profile", { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Взять выходной", exact: true }).click();
      assert.ok(await page.locator('input[type="date"]').count());
      await page.locator(".training-cal-cell-attend.mark-present").first().click();
      assert.ok((await page.locator(".mobile-calendar-detail").textContent()).includes("Был"));
      await page.getByRole("button", { name: "Кастомизация профиля", exact: true }).click();
      const customization = page.locator(".profile-bg-panel");
      await customization.waitFor();
      const dialog = await customization.boundingBox();
      assert.ok(dialog.x >= 0 && dialog.x + dialog.width <= 391 && dialog.y >= 0 && dialog.y + dialog.height <= 901, "customization dialog extends beyond the viewport");
      await customization.getByRole("button", { name: "Закрыть", exact: true }).click();
      await page.getByRole("button", { name: "Открыть техподдержку" }).click();
      await page.getByRole("dialog", { name: "Техподдержка" }).waitFor();
      const support = await page.locator(".support-panel").boundingBox();
      assert.ok(support.x >= 0 && support.x + support.width <= 391 && support.y >= 0 && support.y + support.height <= 901, "support panel extends beyond the viewport");
      await page.locator(".support-head-actions button").last().click();
      await page.setViewportSize({ width: 844, height: 390 });
      await page.waitForFunction(() => document.documentElement.scrollWidth <= 846);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.waitForFunction(() => Number(getComputedStyle(document.querySelector(".canvas-scale-stage")).zoom) < 1);
      await page.setViewportSize({ width: 390, height: 900 });
      await page.waitForFunction(() => Number(getComputedStyle(document.querySelector(".canvas-scale-stage")).zoom) === 1);
      console.log("mobile menu navigation/Escape + day-off form: OK");
      console.log("calendar details + customization/support dialogs + rotation/desktop resize: OK");
    }
    if (errors.length) failures.push(`${width} runtime: ${[...new Set(errors)].join(" | ")}`);
    if (missing.size) failures.push(`${width} missing fixtures: ${[...missing].join(", ")}`);
    await context.close();
  }
} finally { await browser.close(); }
assert.deepEqual(failures, []);
console.log("All responsive checks passed.");
