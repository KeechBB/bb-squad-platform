/**
 * Количественный инвентарь фонов. Sync unlockedProfileBgs.
 */
import { prisma } from "@/lib/prisma";
import { MARKET_BG_IDS, MARKET_BG_ORDER } from "@/lib/marketBgIds";

async function syncUnlockFlag(userId: string, bgId: string, qty: number) {
  if (!MARKET_BG_IDS.has(bgId)) return;
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { unlockedProfileBgs: true, profileBg: true },
  });
  if (!u) return;
  const list = u.unlockedProfileBgs || [];
  const has = list.includes(bgId);
  if (qty > 0 && !has) {
    await prisma.user.update({
      where: { id: userId },
      data: { unlockedProfileBgs: [...list, bgId] },
    });
    return;
  }
  if (qty <= 0 && has) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        unlockedProfileBgs: list.filter((x) => x !== bgId),
        ...(u.profileBg === bgId ? { profileBg: null } : {}),
      },
    });
  }
}

export async function getBgQty(userId: string, bgId: string): Promise<number> {
  const row = await prisma.profileBgStock.findUnique({
    where: { userId_bgId: { userId, bgId } },
    select: { qty: true },
  });
  return Math.max(0, row?.qty || 0);
}

export async function getBgQtyMap(
  userId: string,
  bgIds: readonly string[]
): Promise<Map<string, number>> {
  const rows = await prisma.profileBgStock.findMany({
    where: { userId, bgId: { in: [...bgIds] } },
    select: { bgId: true, qty: true },
  });
  const map = new Map(bgIds.map((id) => [id, 0]));
  for (const r of rows) map.set(r.bgId, Math.max(0, r.qty));
  return map;
}

export async function sumBgSupply(
  bgIds: readonly string[]
): Promise<Map<string, number>> {
  const rows = await prisma.profileBgStock.groupBy({
    by: ["bgId"],
    where: { bgId: { in: [...bgIds] }, qty: { gt: 0 } },
    _sum: { qty: true },
  });
  const map = new Map(bgIds.map((id) => [id, 0]));
  for (const r of rows) map.set(r.bgId, Math.max(0, r._sum.qty || 0));
  return map;
}

export async function addBgQty(
  userId: string,
  bgId: string,
  delta = 1
): Promise<number> {
  const n = Math.max(1, Math.trunc(delta));
  const row = await prisma.profileBgStock.upsert({
    where: { userId_bgId: { userId, bgId } },
    create: { userId, bgId, qty: n },
    update: { qty: { increment: n } },
  });
  await syncUnlockFlag(userId, bgId, row.qty);
  return row.qty;
}

export async function removeBgQty(
  userId: string,
  bgId: string,
  delta = 1
): Promise<{ ok: true; qty: number } | { ok: false; error: "insufficient" }> {
  const n = Math.max(1, Math.trunc(delta));
  const cur = await getBgQty(userId, bgId);
  if (cur < n) return { ok: false, error: "insufficient" };
  const next = cur - n;
  if (next <= 0) {
    await prisma.profileBgStock.deleteMany({ where: { userId, bgId } });
    await syncUnlockFlag(userId, bgId, 0);
    return { ok: true, qty: 0 };
  }
  await prisma.profileBgStock.update({
    where: { userId_bgId: { userId, bgId } },
    data: { qty: next },
  });
  await syncUnlockFlag(userId, bgId, next);
  return { ok: true, qty: next };
}

export async function migrateBgUnlocksToStock(userId: string) {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { unlockedProfileBgs: true },
  });
  if (!u) return;
  let list = [...(u.unlockedProfileBgs || [])];
  // alias tournament → явный bp-l5-gold (один раз), если ещё не продавали
  if (
    list.includes("creator-tournament-02") &&
    !list.includes("bp-l5-gold")
  ) {
    const sold = await prisma.bbCoinTx.findFirst({
      where: {
        userId,
        kind: "bg_sell",
        note: { contains: "bp-l5-gold" },
      },
      select: { id: true },
    });
    if (!sold) {
      list = [...list, "bp-l5-gold"];
      await prisma.user.update({
        where: { id: userId },
        data: { unlockedProfileBgs: list },
      });
    }
  }
  const uniq = [...new Set(list)].filter((id) => MARKET_BG_IDS.has(id));
  if (!uniq.length) return;
  const existing = await prisma.profileBgStock.findMany({
    where: { userId, bgId: { in: uniq } },
    select: { bgId: true },
  });
  const have = new Set(existing.map((r) => r.bgId));
  for (const bgId of uniq) {
    if (have.has(bgId)) continue;
    await prisma.profileBgStock.create({
      data: { userId, bgId, qty: 1 },
    });
  }
}

export async function migrateAllBgUnlocksToStock() {
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { unlockedProfileBgs: { hasSome: [...MARKET_BG_ORDER] } },
        { unlockedProfileBgs: { has: "creator-tournament-02" } },
      ],
    },
    select: { id: true },
  });
  for (const u of users) await migrateBgUnlocksToStock(u.id);
}

let allBgMigrateOnce: Promise<void> | null = null;
export function ensureAllBgStockMigratedOnce() {
  if (!allBgMigrateOnce) {
    allBgMigrateOnce = migrateAllBgUnlocksToStock().catch((e) => {
      allBgMigrateOnce = null;
      throw e;
    });
  }
  return allBgMigrateOnce;
}
