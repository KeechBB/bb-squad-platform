/**
 * Ежедневные акции центробанка (МСК-сутки):
 * — одно оружие: купить −20% (скидка)
 * — другое: купить +20% (наценка)
 * Выбор детерминированный от даты — у всех одинаково.
 */
import { MARKET_PATCH_ORDER, type MarketPatchId } from "@/lib/marketPatchIds";
import {
  PATCH_SELL_OF_BUY,
  patchBuyPriceBbc,
} from "@/lib/bbCoinPatchPrices";
import type { ProfilePatchId } from "@/lib/profilePatches";
import { mskYmd } from "@/lib/eventDay";

export const DAILY_DISCOUNT_MULT = 0.8;
export const DAILY_MARKUP_MULT = 1.2;

export type DailyDealKind = "discount" | "markup" | null;

export type DailyMarketDeals = {
  day: string;
  discountId: MarketPatchId;
  markupId: MarketPatchId;
};

function hashYmd(ymd: string): number {
  let h = 2166136261;
  for (let i = 0; i < ymd.length; i++) {
    h ^= ymd.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Два разных id из каталога на сутки МСК. */
export function dailyMarketDeals(day = mskYmd()): DailyMarketDeals {
  const n = MARKET_PATCH_ORDER.length;
  if (n < 2) {
    const only = MARKET_PATCH_ORDER[0];
    return { day, discountId: only, markupId: only };
  }
  const h = hashYmd(`bb-market-deal:${day}`);
  const i = h % n;
  let j = (h >>> 8) % n;
  if (j === i) j = (j + 1 + (h % (n - 1))) % n;
  if (j === i) j = (i + 1) % n;
  return {
    day,
    discountId: MARKET_PATCH_ORDER[i],
    markupId: MARKET_PATCH_ORDER[j],
  };
}

export function dailyDealKindFor(
  patchId: string,
  day = mskYmd()
): DailyDealKind {
  const d = dailyMarketDeals(day);
  if (patchId === d.discountId) return "discount";
  if (patchId === d.markupId) return "markup";
  return null;
}

/** Цена купить с учётом дневной акции. */
export function patchBuyPriceBbcToday(
  id: ProfilePatchId,
  day = mskYmd()
): number {
  const base = patchBuyPriceBbc(id);
  const kind = dailyDealKindFor(id, day);
  if (kind === "discount") return Math.max(1, Math.round(base * DAILY_DISCOUNT_MULT));
  if (kind === "markup") return Math.max(1, Math.round(base * DAILY_MARKUP_MULT));
  return base;
}

/** Продать = 80% от сегодняшней цены купить. */
export function patchSellPriceBbcToday(
  id: ProfilePatchId,
  day = mskYmd()
): number {
  return Math.max(1, Math.round(patchBuyPriceBbcToday(id, day) * PATCH_SELL_OF_BUY));
}
