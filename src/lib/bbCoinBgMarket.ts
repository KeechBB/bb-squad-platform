/**
 * Каталог и сделки центробанка фонов за BB Coins.
 */
import { prisma } from "@/lib/prisma";
import { isProfileBgId } from "@/lib/profileBg";
import { creditBbCoins, debitBbCoins, getBbCoinBalance } from "@/lib/bbCoins";
import { marketBgMeta, type MarketBgCard } from "@/lib/bbCoinBgPrices";
import {
  dailyBgDealKindFor,
  dailyBgDeals,
  bgBuyPriceBbcToday,
  bgSellPriceBbcToday,
} from "@/lib/bbCoinBgDailyDeals";
import { MARKET_BG_ORDER, isMarketBgId } from "@/lib/marketBgIds";
import { SITE_CREATOR_STEAM_ID } from "@/lib/profileBg";
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
  if (list.includes(KEECH_BG_SEED_FLAG)) return;

  const set = new Set(list);
  for (const id of MARKET_BG_ORDER) {
    const qty = await getBgQty(u.id, id);
    if (qty < 1) await addBgQty(u.id, id, 1);
    set.add(id);
  }
  set.add(KEECH_BG_SEED_FLAG);
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

  return MARKET_BG_ORDER.map((id) => {
    const meta = marketBgMeta(id);
    const myQty = mine.get(id) || 0;
    return {
      ...meta,
      buy: bgBuyPriceBbcToday(id, day),
      sell: bgSellPriceBbcToday(id, day),
      buyBase: meta.buyBase,
      mine: myQty,
      total: total.get(id) || 0,
      owned: myQty > 0,
      deal: dailyBgDealKindFor(id, day),
      dealDay: deals.day,
    };
  });
}

export async function buyMarketBg(opts: {
  userId: string;
  bgId: string;
}): Promise<
  | { ok: true; balance: number; mine: number; owned: true }
  | { ok: false; error: string }
> {
  if (!isProfileBgId(opts.bgId) || !isMarketBgId(opts.bgId)) {
    return { ok: false, error: "bg" };
  }
  const bgId = opts.bgId;
  const day = mskYmd();
  const price = bgBuyPriceBbcToday(bgId, day);
  const deal = dailyBgDealKindFor(bgId, day);

  const bal = await getBbCoinBalance(opts.userId);
  if (bal < price) return { ok: false, error: "insufficient" };

  const dealNote =
    deal === "discount"
      ? " · скидка −20%"
      : deal === "markup"
        ? " · наценка +20%"
        : "";
  const debited = await debitBbCoins({
    userId: opts.userId,
    amount: price,
    kind: "bg_buy",
    ref: null,
    note: `Покупка фона ${bgId} (−${price} BBC)${dealNote}`,
  });
  if (!debited.ok) {
    return {
      ok: false,
      error: debited.error === "insufficient" ? "insufficient" : "debit",
    };
  }

  const mine = await addBgQty(opts.userId, bgId, 1);
  return { ok: true, balance: debited.balance, mine, owned: true };
}

export async function sellMarketBg(opts: {
  userId: string;
  bgId: string;
}): Promise<
  | { ok: true; balance: number; mine: number; owned: boolean }
  | { ok: false; error: string }
> {
  if (!isProfileBgId(opts.bgId) || !isMarketBgId(opts.bgId)) {
    return { ok: false, error: "bg" };
  }
  const bgId = opts.bgId;
  const day = mskYmd();
  const price = bgSellPriceBbcToday(bgId, day);
  const deal = dailyBgDealKindFor(bgId, day);

  await migrateBgUnlocksToStock(opts.userId);
  const removed = await removeBgQty(opts.userId, bgId, 1);
  if (!removed.ok) return { ok: false, error: "not_owned" };

  const dealNote =
    deal === "sellboost"
      ? " · продажа +20%"
      : deal === "discount"
        ? " · скидка −20%"
        : deal === "markup"
          ? " · наценка +20%"
          : "";
  const credited = await creditBbCoins({
    userId: opts.userId,
    amount: price,
    kind: "bg_sell",
    ref: `${bgId}:${Date.now()}`,
    note: `Продажа фона ${bgId} (+${price} BBC)${dealNote}`,
  });
  if (!credited.ok) {
    await addBgQty(opts.userId, bgId, 1);
    return { ok: false, error: "credit" };
  }
  return {
    ok: true,
    balance: credited.balance,
    mine: removed.qty,
    owned: removed.qty > 0,
  };
}
