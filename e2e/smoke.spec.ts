import { expect, test } from "@playwright/test";
import { resolveAbsenceReason } from "../src/lib/absenceReasons";

/**
 * Публичный smoke против живого сайта (SMOKE_BASE_URL).
 * Авторизованные сценарии (резерв/выходной) — позже через storageState.
 */

test.describe("unit: absence reasons", () => {
  test("preset → строка причины", () => {
    expect(resolveAbsenceReason("Учёба", "")).toBe("Учёба");
    expect(resolveAbsenceReason("Другое", "  поездка  ")).toBe("поездка");
    expect(resolveAbsenceReason("Другое", "ab")).toBe("ab");
  });
});

test.describe("live smoke", () => {
  test("главная открывается", async ({ page }) => {
    const res = await page.goto("/", { waitUntil: "domcontentloaded" });
    expect(res?.ok() || res?.status() === 304).toBeTruthy();
    await expect(page.locator("body")).toBeVisible();
  });

  test("публичная витрина /public", async ({ page }) => {
    const res = await page.goto("/public", { waitUntil: "domcontentloaded" });
    expect(res?.status()).toBeLessThan(500);
    await expect(page.locator("body")).toBeVisible();
  });

  test("профиль без сессии не 500", async ({ page }) => {
    const res = await page.goto("/profile", { waitUntil: "domcontentloaded" });
    expect(res?.status()).toBeLessThan(500);
    await expect(page.locator("body")).toBeVisible();
  });

  test("shell API без сессии → 401", async ({ request }) => {
    const res = await request.get("/api/profile/shell");
    expect(res.status()).toBe(401);
  });

  test("site-version отдаёт JSON с версией", async ({ request }) => {
    const res = await request.get("/api/public/site-version");
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    const ver =
      data?.version ||
      data?.label ||
      data?.beta ||
      data?.current ||
      null;
    expect(ver).toBeTruthy();
  });
});
