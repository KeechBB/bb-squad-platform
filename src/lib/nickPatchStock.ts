/**
 * Количественный инвентарь нашивок (несколько копий одной).
 * unlockedNickPatches синхронизируется: qty>0 → id есть, qty=0 → id убран.
 */
import { prisma } from "@/lib/prisma";
import { MARKET_PATCH_IDS, MARKET_PATCH_ORDER } from "@/lib/marketPatchIds";

async function syncUnlockFlag(userId: string, patchId: string, qty: number) {
  // Маркет-id + легендарка из кейсов (не в магазине).
  const caseOnly =
    patchId === "creator-svd-faction-lord" ||
    patchId === "creator-gp-drum-berry-lore" ||
    patchId === "creator-rpg7-orchard-harvest" ||
    patchId === "creator-fruit-strike-ak-v2";
  if (!MARKET_PATCH_IDS.has(patchId) && !caseOnly) return;
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
  const { economyStockUserFilter } = await import(
    "@/lib/marketEconomyExclude"
  );
  const exclude = await economyStockUserFilter();
  const rows = await prisma.nickPatchStock.groupBy({
    by: ["patchId"],
    where: {
      patchId: { in: [...patchIds] },
      qty: { gt: 0 },
      ...exclude,
    },
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
 * Источник правды для маркета/кейсов: qty>0 → unlock есть.
 * Чинит рассинхрон, когда копии на складе есть, а unlockedNickPatches пустой
 * (после продажи всех копий unlock снимался, а после новой покупки/дропа
 * migrateUnlocksToStock мог снова стереть флаг из‑за истории продаж).
 */
export async function syncUnlocksFromStock(userId: string): Promise<string[]> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { unlockedNickPatches: true, nickPatch: true },
  });
  if (!u) return [];
  const stocks = await prisma.nickPatchStock.findMany({
    where: { userId, qty: { gt: 0 } },
    select: { patchId: true },
  });
  const inStock = new Set(stocks.map((r) => r.patchId));
  const prev = u.unlockedNickPatches || [];
  const keptAliases = prev.filter(
    (id) =>
      !MARKET_PATCH_IDS.has(id) &&
      id !== "creator-svd-faction-lord" &&
      id !== "creator-gp-drum-berry-lore" &&
      id !== "creator-rpg7-orchard-harvest" &&
      id !== "creator-fruit-strike-ak-v2"
  );
  const next = Array.from(
    new Set([...keptAliases, ...Array.from(inStock)])
  );
  const same =
    next.length === prev.length && next.every((id) => prev.includes(id));
  if (!same) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        unlockedNickPatches: next,
        ...(u.nickPatch && !inStock.has(u.nickPatch) && !keptAliases.includes(u.nickPatch)
          ? { nickPatch: null }
          : {}),
      },
    });
  }
  return next;
}

/**
 * Разовая миграция: market-id в unlockedNickPatches → stock qty=1,
 * если строки stock ещё нет.
 * Unlock снимаем только если когда‑то продавали И сейчас qty=0
 * (иначе BP/ensure снова поднимает «проданные» нашивки без копий).
 * Если qty>0 — unlock оставляем / восстанавливаем через syncUnlocksFromStock.
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
  const stockRows = await prisma.nickPatchStock.findMany({
    where: {
      userId,
      patchId: { in: [...MARKET_PATCH_ORDER] },
      qty: { gt: 0 },
    },
    select: { patchId: true },
  });
  const haveStock = new Set(stockRows.map((r) => r.patchId));

  if (unlocks.length) {
    const soldRows = await prisma.bbCoinTx.findMany({
      where: {
        userId,
        kind: "patch_sell",
        OR: unlocks.map((id) => ({ note: { contains: id } })),
      },
      select: { note: true },
    });
    const sold = new Set<string>();
    for (const row of soldRows) {
      const note = String(row.note || "");
      for (const id of unlocks) {
        if (note.includes(id)) sold.add(id);
      }
    }
    // Снимаем unlock только у реально пустых (продали всё и не докупили).
    const strip = [...sold].filter((id) => !haveStock.has(id));
    if (strip.length) {
      const stripSet = new Set(strip);
      const next = (u.unlockedNickPatches || []).filter((id) => !stripSet.has(id));
      if (next.length !== (u.unlockedNickPatches || []).length) {
        await prisma.user.update({
          where: { id: userId },
          data: { unlockedNickPatches: next },
        });
      }
    }
    const keep = unlocks.filter((id) => !sold.has(id) || haveStock.has(id));
    const existing = await prisma.nickPatchStock.findMany({
      where: { userId, patchId: { in: keep } },
      select: { patchId: true },
    });
    const have = new Set(existing.map((r) => r.patchId));
    for (const patchId of keep) {
      if (have.has(patchId)) continue;
      await prisma.nickPatchStock.create({
        data: { userId, patchId, qty: 1 },
      });
    }
  }

  await syncUnlocksFromStock(userId);
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

let allMigrateOnce: Promise<void> | null = null;
/** Раз на процесс PM2 — чтобы «всего» совпадало с unlocks у всех игроков. */
export function ensureAllMarketStockMigratedOnce() {
  if (!allMigrateOnce) {
    allMigrateOnce = migrateAllMarketUnlocksToStock().catch((e) => {
      allMigrateOnce = null;
      throw e;
    });
  }
  return allMigrateOnce;
}
