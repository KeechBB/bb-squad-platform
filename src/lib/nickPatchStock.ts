/**
 * Количественный инвентарь нашивок (несколько копий одной).
 * unlockedNickPatches синхронизируется: qty>0 → id есть, qty=0 → id убран.
 */
import { prisma } from "@/lib/prisma";
import { MARKET_PATCH_IDS, MARKET_PATCH_ORDER } from "@/lib/marketPatchIds";

async function syncUnlockFlag(userId: string, patchId: string, qty: number) {
  if (!MARKET_PATCH_IDS.has(patchId)) return;
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { unlockedNickPatches: true, nickPatch: true },
  });
  if (!u) return;
  const list = u.unlockedNickPatches || [];
  const has = list.includes(patchId);
  if (qty > 0 && !has) {
    await prisma.user.update({
      where: { id: userId },
      data: { unlockedNickPatches: [...list, patchId] },
    });
    return;
  }
  if (qty <= 0 && has) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        unlockedNickPatches: list.filter((x) => x !== patchId),
        ...(u.nickPatch === patchId ? { nickPatch: null } : {}),
      },
    });
  }
}

export async function getPatchQty(userId: string, patchId: string): Promise<number> {
  const row = await prisma.nickPatchStock.findUnique({
    where: { userId_patchId: { userId, patchId } },
    select: { qty: true },
  });
  return Math.max(0, row?.qty || 0);
}

export async function getPatchQtyMap(
  userId: string,
  patchIds: readonly string[]
): Promise<Map<string, number>> {
  const rows = await prisma.nickPatchStock.findMany({
    where: { userId, patchId: { in: [...patchIds] } },
    select: { patchId: true, qty: true },
  });
  const map = new Map(patchIds.map((id) => [id, 0]));
  for (const r of rows) map.set(r.patchId, Math.max(0, r.qty));
  return map;
}

export async function sumPatchSupply(
  patchIds: readonly string[]
): Promise<Map<string, number>> {
  const rows = await prisma.nickPatchStock.groupBy({
    by: ["patchId"],
    where: { patchId: { in: [...patchIds] }, qty: { gt: 0 } },
    _sum: { qty: true },
  });
  const map = new Map(patchIds.map((id) => [id, 0]));
  for (const r of rows) {
    map.set(r.patchId, Math.max(0, r._sum.qty || 0));
  }
  return map;
}

/** +N копий. Возвращает новый qty. */
export async function addPatchQty(
  userId: string,
  patchId: string,
  delta = 1
): Promise<number> {
  const n = Math.max(1, Math.trunc(delta));
  const row = await prisma.nickPatchStock.upsert({
    where: { userId_patchId: { userId, patchId } },
    create: { userId, patchId, qty: n },
    update: { qty: { increment: n } },
  });
  await syncUnlockFlag(userId, patchId, row.qty);
  return row.qty;
}

/** −N копий. false если не хватает. */
export async function removePatchQty(
  userId: string,
  patchId: string,
  delta = 1
): Promise<{ ok: true; qty: number } | { ok: false; error: "insufficient" }> {
  const n = Math.max(1, Math.trunc(delta));
  const cur = await getPatchQty(userId, patchId);
  if (cur < n) return { ok: false, error: "insufficient" };
  const next = cur - n;
  if (next <= 0) {
    await prisma.nickPatchStock.deleteMany({
      where: { userId, patchId },
    });
    await syncUnlockFlag(userId, patchId, 0);
    return { ok: true, qty: 0 };
  }
  await prisma.nickPatchStock.update({
    where: { userId_patchId: { userId, patchId } },
    data: { qty: next },
  });
  await syncUnlockFlag(userId, patchId, next);
  return { ok: true, qty: next };
}

/**
 * Разовая миграция: market-id в unlockedNickPatches → stock qty=1,
 * если строки stock ещё нет.
 */
export async function migrateUnlocksToStock(userId: string) {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { unlockedNickPatches: true },
  });
  if (!u) return;
  const unlocks = (u.unlockedNickPatches || []).filter((id) =>
    MARKET_PATCH_IDS.has(id)
  );
  if (!unlocks.length) return;
  const existing = await prisma.nickPatchStock.findMany({
    where: { userId, patchId: { in: unlocks } },
    select: { patchId: true },
  });
  const have = new Set(existing.map((r) => r.patchId));
  for (const patchId of unlocks) {
    if (have.has(patchId)) continue;
    await prisma.nickPatchStock.create({
      data: { userId, patchId, qty: 1 },
    });
  }
}

/** Глобальная миграция всех, у кого есть market unlock без stock. */
export async function migrateAllMarketUnlocksToStock() {
  const users = await prisma.user.findMany({
    where: {
      unlockedNickPatches: { hasSome: [...MARKET_PATCH_ORDER] },
    },
    select: { id: true },
  });
  for (const u of users) {
    await migrateUnlocksToStock(u.id);
  }
}
