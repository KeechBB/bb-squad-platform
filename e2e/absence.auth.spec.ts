import { expect, test, type APIRequestContext } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";

const AUTH_FILE = join(__dirname, "../qa/auth/storage.json");
const REASON = "QA smoke автотест";

function tomorrowIsoLocal(): string {
  const n = new Date();
  n.setDate(n.getDate() + 1);
  const y = n.getFullYear();
  const m = String(n.getMonth() + 1).padStart(2, "0");
  const d = String(n.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function clearAbsence(request: APIRequestContext) {
  await request.delete("/api/profile/day-off");
  await request.delete("/api/profile/reserve");
}

async function shell(request: APIRequestContext) {
  const res = await request.get("/api/profile/shell");
  expect(res.ok(), `shell ${res.status()}`).toBeTruthy();
  return res.json() as Promise<{ dayOffActive?: boolean }>;
}

test.describe("auth: выходной round-trip", () => {
  test.skip(
    !existsSync(AUTH_FILE),
    "нет qa/auth/storage.json — npm run test:auth:save"
  );

  test.afterEach(async ({ request }) => {
    await clearAbsence(request);
  });

  test("API: взять выходной → статус → снять", async ({ request }) => {
    await clearAbsence(request);

    const until = tomorrowIsoLocal();
    const post = await request.post("/api/profile/day-off", {
      data: { until, reason: REASON },
    });
    const postBody = await post.json().catch(() => ({}));
    expect(post.ok(), JSON.stringify(postBody)).toBeTruthy();

    const mid = await shell(request);
    expect(mid.dayOffActive).toBe(true);

    const del = await request.delete("/api/profile/day-off");
    expect(del.ok()).toBeTruthy();

    const end = await shell(request);
    expect(end.dayOffActive).toBe(false);
  });

  test("UI: заявка принята (alert) → статус → снять", async ({ page, request }) => {
    await clearAbsence(request);

    const alerts: string[] = [];
    page.on("dialog", async (d) => {
      alerts.push(d.message());
      await d.accept();
    });

    await page.goto("/profile", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "Взять выходной" })).toBeVisible({
      timeout: 20_000,
    });

    await page.getByRole("button", { name: "Взять выходной" }).click();
    await page.locator('input[type="date"]').fill(tomorrowIsoLocal());
    await page.getByRole("button", { name: "Другое" }).click();
    await page.locator("textarea.absence-reason-custom").fill(REASON);
    await page.getByRole("button", { name: "Ок" }).click();

    await expect.poll(() => alerts.some((m) => /Заявка принята/i.test(m)), {
      timeout: 15_000,
    }).toBeTruthy();

    await page.waitForURL(/\/profile/, { timeout: 20_000 });
    await expect(page.getByText(/Выходной до/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Снять выходной" })).toBeVisible();

    await page.getByRole("button", { name: "Снять выходной" }).click();
    await expect.poll(() => alerts.some((m) => /выходной снят/i.test(m)), {
      timeout: 15_000,
    }).toBeTruthy();

    await expect(page.getByRole("button", { name: "Взять выходной" })).toBeVisible({
      timeout: 20_000,
    });
  });
});
