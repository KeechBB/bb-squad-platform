/**
 * Каталог и сделки центробанка нашивок за BB Coins.
 * Несколько копий одной нашивки: buy +1, sell −1.
 */
import { prisma } from "@/lib/prisma";
import { isProfilePatchId } from "@/lib/profilePatches";
import { creditBbCoins, debitBbCoins, getBbCoinBalance } from "@/lib/bbCoins";
import {
  marketPatchMeta,
  type MarketPatchCard,
} from "@/lib/bbCoinPatchPrices";
import {
  dailyDealKindFor,
  dailyMarketDeals,
  patchBuyPriceBbcToday,
  patchSellPriceBbcToday,
} from "@/lib/bbCoinDailyDeals";
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
import { mskYmd } from "@/lib/eventDay";

/** Маркер: стартовый инвентарь Keech уже выдан. */
const KEECH_MARKET_SEED_FLAG = "__market_keech_seed_v1";

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
  const { ensureAllMarketStockMigratedOnce } = await import(
    "@/lib/nickPatchStock"
  );
  await ensureAllMarketStockMigratedOnce();
  await migrateUnlocksToStock(opts.userId);

  const [mine, total] = await Promise.all([
    getPatchQtyMap(opts.userId, MARKET_PATCH_ORDER),
    sumPatchSupply(MARKET_PATCH_ORDER),
  ]);

  const day = mskYmd();
  const deals = dailyMarketDeals(day);

  return MARKET_PATCH_ORDER.map((id) => {
    const meta = marketPatchMeta(id);
    const myQty = mine.get(id) || 0;
    const deal = dailyDealKindFor(id, day);
    return {
      ...meta,
      buy: patchBuyPriceBbcToday(id, day),
      sell: patchSellPriceBbcToday(id, day),
      buyBase: meta.buyBase,
      mine: myQty,
      total: total.get(id) || 0,
      owned: myQty > 0,
      deal,
      dealDay: deals.day,
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
  const day = mskYmd();
  const price = patchBuyPriceBbcToday(patchId, day);
  const deal = dailyDealKindFor(patchId, day);

  const bal = await getBbCoinBalance(opts.userId);
  if (bal < price) return { ok: false, error: "insufficient" };

  const dealNote =
    deal === "discount" ? " · скидка −20%" : deal === "markup" ? " · наценка +20%" : "";
  const debited = await debitBbCoins({
    userId: opts.userId,
    amount: price,
    kind: "patch_buy",
    ref: null,
    note: `Покупка нашивки ${patchId} (−${price} BBC)${dealNote}`,
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
  const day = mskYmd();
  const price = patchSellPriceBbcToday(patchId, day);
  const deal = dailyDealKindFor(patchId, day);

  await migrateUnlocksToStock(opts.userId);

  const removed = await removePatchQty(opts.userId, patchId, 1);
  if (!removed.ok) {
    return { ok: false, error: "not_owned" };
  }

  const dealNote =
    deal === "discount" ? " · скидка −20%" : deal === "markup" ? " · наценка +20%" : "";
  const credited = await creditBbCoins({
    userId: opts.userId,
    amount: price,
    kind: "patch_sell",
    ref: `${patchId}:${Date.now()}`,
    note: `Продажа нашивки ${patchId} (+${price} BBC)${dealNote}`,
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
