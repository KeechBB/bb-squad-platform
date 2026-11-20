/**
 * Каталог и сделки центробанка шрифтов ника за BB Coins.
 */
import { prisma } from "@/lib/prisma";
import { isProfileNickStyleId } from "@/lib/profileNickStyles";
import { marketFontMeta, type MarketFontCard } from "@/lib/bbCoinFontPrices";
import { dailyFontDeals } from "@/lib/bbCoinFontDailyDeals";
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
import { resolveListingPrice } from "@/lib/marketListingPrices";
import { chargeMarketBuy, creditMarketSell } from "@/lib/marketCharge";
import { resolveBdGiftRecipient } from "@/lib/marketFactionPay";

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

  const cards: MarketFontCard[] = [];
  for (const id of MARKET_FONT_ORDER) {
    const meta = marketFontMeta(id);
    const myQty = mine.get(id) || 0;
    const price = await resolveListingPrice("font", id, day);
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

export async function buyMarketFont(opts: {
  userId: string;
  steamId: string;
  styleId: string;
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
  if (!isProfileNickStyleId(opts.styleId) || !isMarketFontId(opts.styleId)) {
    return { ok: false, error: "font" };
  }
  const price = await resolveListingPrice("font", opts.styleId);
  if (!price) return { ok: false, error: "font" };

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
    kind: "font_buy",
    noteItem: `шрифта ${opts.styleId}${
      recipientId !== opts.userId ? ` → gift:${recipientId}` : ""
    }`,
    spendTreasury,
  });
  if (!charged.ok) return charged;

  await addFontQty(recipientId, opts.styleId, 1);
  const mine = await getFontQty(opts.userId, opts.styleId);
  return {
    ok: true,
    balance: charged.balance,
    mine,
    owned: true,
    currency: charged.currency,
    paidFrom: charged.paidFrom,
    giftedToUserId: recipientId !== opts.userId ? recipientId : undefined,
  };
}

export async function sellMarketFont(opts: {
  userId: string;
  steamId: string;
  styleId: string;
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
  if (!isProfileNickStyleId(opts.styleId) || !isMarketFontId(opts.styleId)) {
    return { ok: false, error: "font" };
  }
  const price = await resolveListingPrice("font", opts.styleId);
  if (!price) return { ok: false, error: "font" };

  await migrateFontUnlocksToStock(opts.userId);
  const removed = await removeFontQty(opts.userId, opts.styleId, 1);
  if (!removed.ok) return { ok: false, error: "not_owned" };

  const credited = await creditMarketSell({
    userId: opts.userId,
    steamId: opts.steamId,
    price,
    kind: "font_sell",
    noteItem: `шрифта ${opts.styleId}`,
    rollback: async () => {
      await addFontQty(opts.userId, opts.styleId, 1);
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
