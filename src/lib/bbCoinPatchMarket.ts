/**
 * Каталог и сделки центробанка нашивок за BB Coins.
 * Несколько копий одной нашивки: buy +1, sell −1.
 */
import { prisma } from "@/lib/prisma";
import { isProfilePatchId } from "@/lib/profilePatches";
import {
  marketPatchMeta,
  type MarketPatchCard,
} from "@/lib/bbCoinPatchPrices";
import { dailyMarketDeals } from "@/lib/bbCoinDailyDeals";
import {
  isMarketSellOnlyPatch,
  MARKET_PATCH_ORDER,
} from "@/lib/marketPatchIds";
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
import { resolveListingPrice } from "@/lib/marketListingPrices";
import { chargeMarketBuy, creditMarketSell } from "@/lib/marketCharge";
import { resolveBdGiftRecipient } from "@/lib/marketFactionPay";

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

  const cards: MarketPatchCard[] = [];
  for (const id of MARKET_PATCH_ORDER) {
    const meta = marketPatchMeta(id);
    const myQty = mine.get(id) || 0;
    const price = await resolveListingPrice("patch", id, day);
    if (!price) continue;
    cards.push({
      ...meta,
      buy: price.buy,
      sell: price.sell,
      buyBase: price.buyBase,
      sellBase: price.sellBase,
      mine: myQty,
      total: total.get(id) || 0,
      owned: myQty > 0,
      deal: isMarketSellOnlyPatch(id) ? null : price.deal,
      dealDay: deals.day,
      currency: price.currency,
      buyDisabled: isMarketSellOnlyPatch(id),
    });
  }
  return cards;
}

export async function buyMarketPatch(opts: {
  userId: string;
  steamId: string;
  patchId: string;
  giftToUserId?: string | null;
}): Promise<
  | {
      ok: true;
      balance: number;
      mine: number;
      owned: true;
      currency: "BBC" | "BD";
      paidFrom?: "treasury" | "personal" | "bbc" | "infinite";
      giftedToUserId?: string;
    }
  | { ok: false; error: string }
> {
  if (!isProfilePatchId(opts.patchId)) {
    return { ok: false, error: "patch" };
  }
  if (isMarketSellOnlyPatch(opts.patchId)) {
    return { ok: false, error: "buy_disabled" };
  }
  const price = await resolveListingPrice("patch", opts.patchId);
  if (!price) return { ok: false, error: "patch" };

  let recipientId = opts.userId;
  let spendTreasury = false;
  if (price.currency === "BD") {
    const gift = await resolveBdGiftRecipient({
      buyerUserId: opts.userId,
      buyerSteamId: opts.steamId,
      giftToUserId: opts.giftToUserId,
    });
    if (!gift.ok) return gift;
    recipientId = gift.recipientUserId;
    spendTreasury = gift.spendTreasury;
  }

  const charged = await chargeMarketBuy({
    userId: opts.userId,
    steamId: opts.steamId,
    price,
    kind: "patch_buy",
    noteItem: `нашивки ${opts.patchId}${
      recipientId !== opts.userId ? ` → gift:${recipientId}` : ""
    }`,
    spendTreasury,
  });
  if (!charged.ok) return charged;

  const mine = await addPatchQty(recipientId, opts.patchId, 1);
  await writeNickPatchesCache().catch(() => null);
  return {
    ok: true,
    balance: charged.balance,
    mine: recipientId === opts.userId ? mine : await getPatchQty(opts.userId, opts.patchId),
    owned: true,
    currency: charged.currency,
    paidFrom: charged.paidFrom,
    giftedToUserId: recipientId !== opts.userId ? recipientId : undefined,
  };
}

export async function sellMarketPatch(opts: {
  userId: string;
  steamId: string;
  patchId: string;
}): Promise<
  | {
      ok: true;
      balance: number;
      mine: number;
      owned: boolean;
      currency: "BBC" | "BD";
    }
  | { ok: false; error: string }
> {
  if (!isProfilePatchId(opts.patchId)) {
    return { ok: false, error: "patch" };
  }
  const price = await resolveListingPrice("patch", opts.patchId);
  if (!price) return { ok: false, error: "patch" };

  await migrateUnlocksToStock(opts.userId);
  const removed = await removePatchQty(opts.userId, opts.patchId, 1);
  if (!removed.ok) return { ok: false, error: "not_owned" };

  const credited = await creditMarketSell({
    userId: opts.userId,
    steamId: opts.steamId,
    price,
    kind: "patch_sell",
    noteItem: `нашивки ${opts.patchId}`,
    rollback: async () => {
      await addPatchQty(opts.userId, opts.patchId, 1);
    },
  });
  if (!credited.ok) return credited;

  await writeNickPatchesCache().catch(() => null);
  return {
    ok: true,
    balance: credited.balance,
    mine: removed.qty,
    owned: removed.qty > 0,
    currency: credited.currency,
  };
}
