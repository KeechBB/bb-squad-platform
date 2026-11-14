/**
 * Ежедневные акции шрифтов (МСК 00:00).
 * Пока в каталоге 2 шрифта — каждый день активны только 2 из 3 видов акций
 * (скидка / наценка / продажа+); третий вид отпадает.
 */
import { MARKET_FONT_ORDER, type MarketFontId } from "@/lib/marketFontIds";
import { PATCH_SELL_OF_BUY } from "@/lib/bbCoinPatchPrices";
import { fontBuyPriceBbc } from "@/lib/bbCoinFontPrices";
import { mskYmd } from "@/lib/eventDay";

export const FONT_DAILY_DISCOUNT_MULT = 0.8;
export const FONT_DAILY_MARKUP_MULT = 1.2;
export const FONT_DAILY_SELL_BOOST_MULT = 1.2;

export type FontDailyDealKind = "discount" | "markup" | "sellboost" | null;

export type DailyFontDeals = {
  day: string;
  /** Ровно 2 id заполнены; один вид акции = null (отпал). */
  discountId: MarketFontId | null;
  markupId: MarketFontId | null;
  sellBoostId: MarketFontId | null;
};

const DEAL_KINDS = ["discount", "markup", "sellboost"] as const;

function hashYmd(ymd: string): number {
  let h = 2166136261;
  for (let i = 0; i < ymd.length; i++) {
    h ^= ymd.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function shuffleInPlace<T>(arr: T[], next: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = next() % (i + 1);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
}

export function dailyFontDeals(day = mskYmd()): DailyFontDeals {
  const fonts = [...MARKET_FONT_ORDER];
  const kinds = [...DEAL_KINDS];
  let state = hashYmd(`bb-market-font-deal-v1:${day}`);
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
  shuffleInPlace(fonts, next);
  shuffleInPlace(kinds, next);

  // Берём 2 шрифта × 2 вида акций; 3-й вид отпадает.
  const active = kinds.slice(0, Math.min(2, fonts.length));
  const out: DailyFontDeals = {
    day,
    discountId: null,
    markupId: null,
    sellBoostId: null,
  };
  for (let i = 0; i < active.length; i++) {
    const kind = active[i];
    const fontId = fonts[i];
    if (kind === "discount") out.discountId = fontId;
    else if (kind === "markup") out.markupId = fontId;
    else out.sellBoostId = fontId;
  }
  return out;
}

export function dailyFontDealKindFor(
  fontId: string,
  day = mskYmd()
): FontDailyDealKind {
  const d = dailyFontDeals(day);
  if (fontId === d.discountId) return "discount";
  if (fontId === d.markupId) return "markup";
  if (fontId === d.sellBoostId) return "sellboost";
  return null;
}

export function fontBuyPriceBbcToday(
  id: MarketFontId,
  day = mskYmd()
): number {
  const base = fontBuyPriceBbc(id);
  const kind = dailyFontDealKindFor(id, day);
  if (kind === "discount") {
    return Math.max(1, Math.round(base * FONT_DAILY_DISCOUNT_MULT));
  }
  if (kind === "markup") {
    return Math.max(1, Math.round(base * FONT_DAILY_MARKUP_MULT));
  }
  return base;
}

export function fontSellPriceBbcToday(
  id: MarketFontId,
  day = mskYmd()
): number {
  let sell = Math.round(fontBuyPriceBbcToday(id, day) * PATCH_SELL_OF_BUY);
  if (dailyFontDealKindFor(id, day) === "sellboost") {
    sell = Math.round(sell * FONT_DAILY_SELL_BOOST_MULT);
  }
  return Math.max(1, sell);
}
