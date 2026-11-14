/**
 * Каталог и сделки центробанка шрифтов ника за BB Coins.
 */
import { prisma } from "@/lib/prisma";
import { isProfileNickStyleId } from "@/lib/profileNickStyles";
import { creditBbCoins, debitBbCoins, getBbCoinBalance } from "@/lib/bbCoins";
import { marketFontMeta, type MarketFontCard } from "@/lib/bbCoinFontPrices";
import {
  dailyFontDealKindFor,
  dailyFontDeals,
  fontBuyPriceBbcToday,
  fontSellPriceBbcToday,
} from "@/lib/bbCoinFontDailyDeals";
import { MARKET_FONT_ORDER, isMarketFontId } from "@/lib/marketFontIds";
import { SITE_CREATOR_STEAM_ID } from "@/lib/profileBg";
import { isBuiltinSuperAdmin } from "@/lib/admin";
import {
  addFontQty,
  ensureAllFontStockMigratedOnce,
  getFontQty,
  getFontQtyMap,
  migrateFontUnlocksToStock,
  removeFontQty,
  sumFontSupply,
} from "@/lib/nickStyleStock";
import { mskYmd } from "@/lib/eventDay";

const KEECH_FONT_SEED_FLAG = "__market_keech_font_seed_v1";

export async function ensureKeechFontStarterInventory(steamId: string) {
  if (!isBuiltinSuperAdmin(steamId) && steamId !== SITE_CREATOR_STEAM_ID) {
    return;
  }
  const u = await prisma.user.findUnique({
    where: { steamId },
    select: { id: true, unlockedNickStyles: true },
  });
  if (!u) return;
  await migrateFontUnlocksToStock(u.id);
  const list = u.unlockedNickStyles || [];
  if (list.includes(KEECH_FONT_SEED_FLAG)) return;

  const set = new Set(list);
  for (const id of MARKET_FONT_ORDER) {
    const qty = await getFontQty(u.id, id);
    if (qty < 1) await addFontQty(u.id, id, 1);
    set.add(id);
  }
  set.add(KEECH_FONT_SEED_FLAG);
  await prisma.user.update({
    where: { id: u.id },
    data: { unlockedNickStyles: [...set] },
  });
}

export async function loadMarketFontCatalog(opts: {
  userId: string;
  steamId: string;
}): Promise<MarketFontCard[]> {
  await ensureKeechFontStarterInventory(opts.steamId);
  await ensureAllFontStockMigratedOnce();
  await migrateFontUnlocksToStock(opts.userId);

  const [mine, total] = await Promise.all([
    getFontQtyMap(opts.userId, MARKET_FONT_ORDER),
    sumFontSupply(MARKET_FONT_ORDER),
  ]);
  const day = mskYmd();
  const deals = dailyFontDeals(day);

  return MARKET_FONT_ORDER.map((id) => {
    const meta = marketFontMeta(id);
    const myQty = mine.get(id) || 0;
    return {
      ...meta,
      buy: fontBuyPriceBbcToday(id, day),
      sell: fontSellPriceBbcToday(id, day),
      buyBase: meta.buyBase,
      mine: myQty,
      total: total.get(id) || 0,
      owned: myQty > 0,
      deal: dailyFontDealKindFor(id, day),
      dealDay: deals.day,
    };
  });
}

export async function buyMarketFont(opts: {
  userId: string;
  styleId: string;
}): Promise<
  | { ok: true; balance: number; mine: number; owned: true }
  | { ok: false; error: string }
> {
  if (!isProfileNickStyleId(opts.styleId) || !isMarketFontId(opts.styleId)) {
    return { ok: false, error: "font" };
  }
  const styleId = opts.styleId;
  const day = mskYmd();
  const price = fontBuyPriceBbcToday(styleId, day);
  const deal = dailyFontDealKindFor(styleId, day);

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
    kind: "font_buy",
    ref: null,
    note: `Покупка шрифта ${styleId} (−${price} BBC)${dealNote}`,
  });
  if (!debited.ok) {
    return {
      ok: false,
      error: debited.error === "insufficient" ? "insufficient" : "debit",
    };
  }

  const mine = await addFontQty(opts.userId, styleId, 1);
  return { ok: true, balance: debited.balance, mine, owned: true };
}

export async function sellMarketFont(opts: {
  userId: string;
  styleId: string;
}): Promise<
  | { ok: true; balance: number; mine: number; owned: boolean }
  | { ok: false; error: string }
> {
  if (!isProfileNickStyleId(opts.styleId) || !isMarketFontId(opts.styleId)) {
    return { ok: false, error: "font" };
  }
  const styleId = opts.styleId;
  const day = mskYmd();
  const price = fontSellPriceBbcToday(styleId, day);
  const deal = dailyFontDealKindFor(styleId, day);

  await migrateFontUnlocksToStock(opts.userId);
  const removed = await removeFontQty(opts.userId, styleId, 1);
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
    kind: "font_sell",
    ref: `${styleId}:${Date.now()}`,
    note: `Продажа шрифта ${styleId} (+${price} BBC)${dealNote}`,
  });
  if (!credited.ok) {
    await addFontQty(opts.userId, styleId, 1);
    return { ok: false, error: "credit" };
  }
  return {
    ok: true,
    balance: credited.balance,
    mine: removed.qty,
    owned: removed.qty > 0,
  };
}
