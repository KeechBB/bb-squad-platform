/**
 * Каталог и сделки центробанка нашивок за BB Coins.
 * Несколько копий одной нашивки: buy +1, sell −1.
 */
import { prisma } from "@/lib/prisma";
import { isProfilePatchId } from "@/lib/profilePatches";
import { creditBbCoins, debitBbCoins, getBbCoinBalance } from "@/lib/bbCoins";
import {
  marketPatchMeta,
  patchBuyPriceBbc,
  patchSellPriceBbc,
  type MarketPatchCard,
} from "@/lib/bbCoinPatchPrices";
import { MARKET_PATCH_ORDER } from "@/lib/marketPatchIds";
import { SITE_CREATOR_STEAM_ID } from "@/lib/profileBg";
import { isBuiltinSuperAdmin } from "@/lib/admin";
import { writeNickPatchesCache } from "@/lib/nickPatchesCache";
import {
  addPatchQty,
  getPatchQty,
  getPatchQtyMap,
  migrateUnlocksToStock,
  removePatchQty,
  sumPatchSupply,
} from "@/lib/nickPatchStock";

/** Маркер: стартовый инвентарь Keech уже выдан. */
const KEECH_MARKET_SEED_FLAG = "__market_keech_seed_v1";

async function ensureL15AliasMaterialized(userId: string, unlocks: string[]) {
  const set = new Set(unlocks);
  if (set.has("bp-l15-keech")) return unlocks;
  if (!set.has("pb1-gold-nick") && !set.has("pb1-profile-customize")) {
    return unlocks;
  }
  const next = [...unlocks, "bp-l15-keech"];
  await prisma.user.update({
    where: { id: userId },
    data: { unlockedNickPatches: next },
  });
  await addPatchQty(userId, "bp-l15-keech", 1).catch(() => null);
  return next;
}

/**
 * Keech: один раз +1 каждой нашивки каталога.
 * Продажа уменьшает qty; повторный seed не делается.
 */
export async function ensureKeechMarketStarterInventory(steamId: string) {
  if (!isBuiltinSuperAdmin(steamId) && steamId !== SITE_CREATOR_STEAM_ID) {
    return;
  }
  const u = await prisma.user.findUnique({
    where: { steamId },
    select: { id: true, unlockedNickPatches: true },
  });
  if (!u) return;
  await migrateUnlocksToStock(u.id);
  const list = u.unlockedNickPatches || [];
  if (list.includes(KEECH_MARKET_SEED_FLAG)) return;

  const set = new Set(list);
  for (const id of MARKET_PATCH_ORDER) {
    const qty = await getPatchQty(u.id, id);
    if (qty < 1) await addPatchQty(u.id, id, 1);
    set.add(id);
  }
  set.add(KEECH_MARKET_SEED_FLAG);
  await prisma.user.update({
    where: { id: u.id },
    data: { unlockedNickPatches: [...set] },
  });
}

export async function loadMarketPatchCatalog(opts: {
  userId: string;
  steamId: string;
}): Promise<MarketPatchCard[]> {
  await ensureKeechMarketStarterInventory(opts.steamId);
  await migrateUnlocksToStock(opts.userId);

  const me = await prisma.user.findUnique({
    where: { id: opts.userId },
    select: { id: true, unlockedNickPatches: true },
  });
  if (me) {
    await ensureL15AliasMaterialized(me.id, me.unlockedNickPatches || []);
  }

  const [mine, total] = await Promise.all([
    getPatchQtyMap(opts.userId, MARKET_PATCH_ORDER),
    sumPatchSupply(MARKET_PATCH_ORDER),
  ]);

  return MARKET_PATCH_ORDER.map((id) => {
    const meta = marketPatchMeta(id);
    const myQty = mine.get(id) || 0;
    return {
      ...meta,
      mine: myQty,
      total: total.get(id) || 0,
      owned: myQty > 0,
    };
  });
}

export async function buyMarketPatch(opts: {
  userId: string;
  steamId: string;
  patchId: string;
}): Promise<
  | { ok: true; balance: number; mine: number; owned: true }
  | { ok: false; error: string }
> {
  if (!isProfilePatchId(opts.patchId)) {
    return { ok: false, error: "patch" };
  }
  const patchId = opts.patchId;
  const price = patchBuyPriceBbc(patchId);

  const bal = await getBbCoinBalance(opts.userId);
  if (bal < price) return { ok: false, error: "insufficient" };

  const debited = await debitBbCoins({
    userId: opts.userId,
    amount: price,
    kind: "patch_buy",
    ref: null,
    note: `Покупка нашивки ${patchId} (−${price} BBC)`,
  });
  if (!debited.ok) {
    return {
      ok: false,
      error: debited.error === "insufficient" ? "insufficient" : "debit",
    };
  }

  const mine = await addPatchQty(opts.userId, patchId, 1);
  await writeNickPatchesCache().catch(() => null);
  return { ok: true, balance: debited.balance, mine, owned: true };
}

export async function sellMarketPatch(opts: {
  userId: string;
  steamId: string;
  patchId: string;
}): Promise<
  | { ok: true; balance: number; mine: number; owned: boolean }
  | { ok: false; error: string }
> {
  if (!isProfilePatchId(opts.patchId)) {
    return { ok: false, error: "patch" };
  }
  const patchId = opts.patchId;
  const price = patchSellPriceBbc(patchId);

  await migrateUnlocksToStock(opts.userId);

  const removed = await removePatchQty(opts.userId, patchId, 1);
  if (!removed.ok) {
    return { ok: false, error: "not_owned" };
  }

  const credited = await creditBbCoins({
    userId: opts.userId,
    amount: price,
    kind: "patch_sell",
    ref: `${patchId}:${Date.now()}`,
    note: `Продажа нашивки ${patchId} (+${price} BBC)`,
  });
  if (!credited.ok) {
    await addPatchQty(opts.userId, patchId, 1);
    return { ok: false, error: "credit" };
  }

  await writeNickPatchesCache().catch(() => null);
  return {
    ok: true,
    balance: credited.balance,
    mine: removed.qty,
    owned: removed.qty > 0,
  };
}
