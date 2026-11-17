/**
 * Каталог и сделки центробанка фонов (BBC или B$ казны).
 */
import { prisma } from "@/lib/prisma";
import { isProfileBgId, SITE_CREATOR_STEAM_ID } from "@/lib/profileBg";
import { getBbCoinBalance } from "@/lib/bbCoins";
import { marketBgMeta, type MarketBgCard } from "@/lib/bbCoinBgPrices";
import { dailyBgDeals } from "@/lib/bbCoinBgDailyDeals";
import { MARKET_BG_ORDER, isMarketBgId } from "@/lib/marketBgIds";
import { isBuiltinSuperAdmin } from "@/lib/admin";
import {
  addBgQty,
  ensureAllBgStockMigratedOnce,
  getBgQty,
  getBgQtyMap,
  migrateBgUnlocksToStock,
  removeBgQty,
  sumBgSupply,
} from "@/lib/profileBgStock";
import { mskYmd } from "@/lib/eventDay";
import { resolveListingPrice } from "@/lib/marketListingPrices";
import { chargeMarketBuy, creditMarketSell } from "@/lib/marketCharge";

const KEECH_BG_SEED_FLAG = "__market_keech_bg_seed_v1";

export async function ensureKeechBgStarterInventory(steamId: string) {
  if (!isBuiltinSuperAdmin(steamId) && steamId !== SITE_CREATOR_STEAM_ID) {
    return;
  }
  const u = await prisma.user.findUnique({
    where: { steamId },
    select: { id: true, unlockedProfileBgs: true },
  });
  if (!u) return;
  await migrateBgUnlocksToStock(u.id);
  const list = u.unlockedProfileBgs || [];
  const set = new Set(list);
  let changed = false;
  for (const id of MARKET_BG_ORDER) {
    const qty = await getBgQty(u.id, id);
    if (qty < 1) {
      await addBgQty(u.id, id, 1);
      changed = true;
    }
    if (!set.has(id)) {
      set.add(id);
      changed = true;
    }
  }
  if (!set.has(KEECH_BG_SEED_FLAG)) {
    set.add(KEECH_BG_SEED_FLAG);
    changed = true;
  }
  if (!changed) return;
  await prisma.user.update({
    where: { id: u.id },
    data: { unlockedProfileBgs: [...set] },
  });
}

export async function loadMarketBgCatalog(opts: {
  userId: string;
  steamId: string;
}): Promise<MarketBgCard[]> {
  await ensureKeechBgStarterInventory(opts.steamId);
  await ensureAllBgStockMigratedOnce();
  await migrateBgUnlocksToStock(opts.userId);

  const [mine, total] = await Promise.all([
    getBgQtyMap(opts.userId, MARKET_BG_ORDER),
    sumBgSupply(MARKET_BG_ORDER),
  ]);
  const day = mskYmd();
  const deals = dailyBgDeals(day);

  const cards: MarketBgCard[] = [];
  for (const id of MARKET_BG_ORDER) {
    const meta = marketBgMeta(id);
    const myQty = mine.get(id) || 0;
    const price = await resolveListingPrice("bg", id, day);
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
      deal: price.deal,
      dealDay: deals.day,
      currency: price.currency,
    });
  }
  return cards;
}

export async function buyMarketBg(opts: {
  userId: string;
  steamId: string;
  bgId: string;
}): Promise<
  | { ok: true; balance: number; mine: number; owned: true; currency: "BBC" | "BD" }
  | { ok: false; error: string }
> {
  if (!isProfileBgId(opts.bgId) || !isMarketBgId(opts.bgId)) {
    return { ok: false, error: "bg" };
  }
  const price = await resolveListingPrice("bg", opts.bgId);
  if (!price) return { ok: false, error: "bg" };

  const charged = await chargeMarketBuy({
    userId: opts.userId,
    steamId: opts.steamId,
    price,
    kind: "bg_buy",
    noteItem: `фона ${opts.bgId}`,
  });
  if (!charged.ok) return charged;

  const mine = await addBgQty(opts.userId, opts.bgId, 1);
  return {
    ok: true,
    balance: charged.balance,
    mine,
    owned: true,
    currency: charged.currency,
  };
}

export async function sellMarketBg(opts: {
  userId: string;
  steamId: string;
  bgId: string;
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
  if (!isProfileBgId(opts.bgId) || !isMarketBgId(opts.bgId)) {
    return { ok: false, error: "bg" };
  }
  const price = await resolveListingPrice("bg", opts.bgId);
  if (!price) return { ok: false, error: "bg" };

  await migrateBgUnlocksToStock(opts.userId);
  const removed = await removeBgQty(opts.userId, opts.bgId, 1);
  if (!removed.ok) return { ok: false, error: "not_owned" };

  const credited = await creditMarketSell({
    userId: opts.userId,
    steamId: opts.steamId,
    price,
    kind: "bg_sell",
    noteItem: `фона ${opts.bgId}`,
    rollback: async () => {
      await addBgQty(opts.userId, opts.bgId, 1);
    },
  });
  if (!credited.ok) return credited;

  return {
    ok: true,
    balance: credited.balance,
    mine: removed.qty,
    owned: removed.qty > 0,
    currency: credited.currency,
  };
}

/** @deprecated leftover import keep for callers that only need BBC balance */
export { getBbCoinBalance };
