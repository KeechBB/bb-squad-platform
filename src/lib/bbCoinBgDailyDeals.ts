/**
 * Ежедневные акции фонов (МСК 00:00) — те же правила, что у нашивок.
 */
import { MARKET_BG_ORDER, type MarketBgId } from "@/lib/marketBgIds";
import { PATCH_SELL_OF_BUY } from "@/lib/bbCoinPatchPrices";
import { bgBuyPriceBbc } from "@/lib/bbCoinBgPrices";
import { mskYmd } from "@/lib/eventDay";

export const BG_DAILY_DISCOUNT_MULT = 0.8;
export const BG_DAILY_MARKUP_MULT = 1.2;
export const BG_DAILY_SELL_BOOST_MULT = 1.2;

export type BgDailyDealKind = "discount" | "markup" | "sellboost" | null;

export type DailyBgDeals = {
  day: string;
  discountId: MarketBgId;
  markupId: MarketBgId;
  sellBoostId: MarketBgId;
};

function hashYmd(ymd: string): number {
  let h = 2166136261;
  for (let i = 0; i < ymd.length; i++) {
    h ^= ymd.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function dailyBgDeals(day = mskYmd()): DailyBgDeals {
  const pool = [...MARKET_BG_ORDER];
  const n = pool.length;
  if (n === 1) {
    const only = pool[0];
    return { day, discountId: only, markupId: only, sellBoostId: only };
  }
  let state = hashYmd(`bb-market-bg-deal-v1:${day}`);
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
  for (let i = n - 1; i > 0; i--) {
    const j = next() % (i + 1);
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }
  return {
    day,
    discountId: pool[0],
    markupId: pool[1 % n],
    sellBoostId: pool[Math.min(2, n - 1)],
  };
}

export function dailyBgDealKindFor(
  bgId: string,
  day = mskYmd()
): BgDailyDealKind {
  const d = dailyBgDeals(day);
  if (bgId === d.discountId) return "discount";
  if (bgId === d.markupId) return "markup";
  if (bgId === d.sellBoostId) return "sellboost";
  return null;
}

export function bgBuyPriceBbcToday(id: MarketBgId, day = mskYmd()): number {
  const base = bgBuyPriceBbc(id);
  const kind = dailyBgDealKindFor(id, day);
  if (kind === "discount") {
    return Math.max(1, Math.round(base * BG_DAILY_DISCOUNT_MULT));
  }
  if (kind === "markup") {
    return Math.max(1, Math.round(base * BG_DAILY_MARKUP_MULT));
  }
  return base;
}

export function bgSellPriceBbcToday(id: MarketBgId, day = mskYmd()): number {
  let sell = Math.round(bgBuyPriceBbcToday(id, day) * PATCH_SELL_OF_BUY);
  if (dailyBgDealKindFor(id, day) === "sellboost") {
    sell = Math.round(sell * BG_DAILY_SELL_BOOST_MULT);
  }
  return Math.max(1, sell);
}
