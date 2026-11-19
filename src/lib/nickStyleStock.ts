/**
 * Количественный инвентарь шрифтов ника. Sync unlockedNickStyles.
 */
import { prisma } from "@/lib/prisma";
import { MARKET_FONT_IDS, MARKET_FONT_ORDER } from "@/lib/marketFontIds";

async function syncUnlockFlag(userId: string, styleId: string, qty: number) {
  if (!MARKET_FONT_IDS.has(styleId)) return;
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { unlockedNickStyles: true, nickStyle: true },
  });
  if (!u) return;
  const list = u.unlockedNickStyles || [];
  const has = list.includes(styleId);
  if (qty > 0 && !has) {
    await prisma.user.update({
      where: { id: userId },
      data: { unlockedNickStyles: [...list, styleId] },
    });
    return;
  }
  if (qty <= 0 && has) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        unlockedNickStyles: list.filter((x) => x !== styleId),
        ...(u.nickStyle === styleId ? { nickStyle: null } : {}),
      },
    });
  }
}

export async function getFontQty(
  userId: string,
  styleId: string
): Promise<number> {
  const row = await prisma.nickStyleStock.findUnique({
    where: { userId_styleId: { userId, styleId } },
    select: { qty: true },
  });
  return Math.max(0, row?.qty || 0);
}

export async function getFontQtyMap(
  userId: string,
  styleIds: readonly string[]
): Promise<Map<string, number>> {
  const rows = await prisma.nickStyleStock.findMany({
    where: { userId, styleId: { in: [...styleIds] } },
    select: { styleId: true, qty: true },
  });
  const map = new Map(styleIds.map((id) => [id, 0]));
  for (const r of rows) map.set(r.styleId, Math.max(0, r.qty));
  return map;
}

export async function sumFontSupply(
  styleIds: readonly string[]
): Promise<Map<string, number>> {
  const { economyStockUserFilter } = await import(
    "@/lib/marketEconomyExclude"
  );
  const exclude = await economyStockUserFilter();
  const rows = await prisma.nickStyleStock.groupBy({
    by: ["styleId"],
    where: {
      styleId: { in: [...styleIds] },
      qty: { gt: 0 },
      ...exclude,
    },
    _sum: { qty: true },
  });
  const map = new Map(styleIds.map((id) => [id, 0]));
  for (const r of rows) map.set(r.styleId, Math.max(0, r._sum.qty || 0));
  return map;
}

export async function addFontQty(
  userId: string,
  styleId: string,
  delta = 1
): Promise<number> {
  const n = Math.max(1, Math.trunc(delta));
  const row = await prisma.nickStyleStock.upsert({
    where: { userId_styleId: { userId, styleId } },
    create: { userId, styleId, qty: n },
    update: { qty: { increment: n } },
  });
  await syncUnlockFlag(userId, styleId, row.qty);
  return row.qty;
}

export async function removeFontQty(
  userId: string,
  styleId: string,
  delta = 1
): Promise<{ ok: true; qty: number } | { ok: false; error: "insufficient" }> {
  const n = Math.max(1, Math.trunc(delta));
  const cur = await getFontQty(userId, styleId);
  if (cur < n) return { ok: false, error: "insufficient" };
  const next = cur - n;
  if (next <= 0) {
    await prisma.nickStyleStock.deleteMany({ where: { userId, styleId } });
    await syncUnlockFlag(userId, styleId, 0);
    return { ok: true, qty: 0 };
  }
  await prisma.nickStyleStock.update({
    where: { userId_styleId: { userId, styleId } },
    data: { qty: next },
  });
  await syncUnlockFlag(userId, styleId, next);
  return { ok: true, qty: next };
}

export async function migrateFontUnlocksToStock(userId: string) {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { unlockedNickStyles: true },
  });
  if (!u) return;
  const uniq = [...new Set(u.unlockedNickStyles || [])].filter((id) =>
    MARKET_FONT_IDS.has(id)
  );
  if (!uniq.length) return;
  const existing = await prisma.nickStyleStock.findMany({
    where: { userId, styleId: { in: uniq } },
    select: { styleId: true },
  });
  const have = new Set(existing.map((r) => r.styleId));
  for (const styleId of uniq) {
    if (have.has(styleId)) continue;
    await prisma.nickStyleStock.create({
      data: { userId, styleId, qty: 1 },
    });
  }
}

export async function migrateAllFontUnlocksToStock() {
  const users = await prisma.user.findMany({
    where: {
      unlockedNickStyles: { hasSome: [...MARKET_FONT_ORDER] },
    },
    select: { id: true },
  });
  for (const u of users) await migrateFontUnlocksToStock(u.id);
}

let allFontMigrateOnce: Promise<void> | null = null;
export function ensureAllFontStockMigratedOnce() {
  if (!allFontMigrateOnce) {
    allFontMigrateOnce = migrateAllFontUnlocksToStock().catch((e) => {
      allFontMigrateOnce = null;
      throw e;
    });
  }
  return allFontMigrateOnce;
}
