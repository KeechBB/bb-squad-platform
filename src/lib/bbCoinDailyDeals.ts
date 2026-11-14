/**
 * Ежедневные акции центробанка (МСК, смена в 00:00):
 * — одно оружие: купить −20% (скидка, красная лента)
 * — другое: купить +20% (наценка, красная лента)
 * — третье: продать +20% (зелёная лента)
 * Три разных id, детерминированно от даты.
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
export const DAILY_SELL_BOOST_MULT = 1.2;

export type DailyDealKind = "discount" | "markup" | "sellboost" | null;

export type DailyMarketDeals = {
  day: string;
  discountId: MarketPatchId;
  markupId: MarketPatchId;
  sellBoostId: MarketPatchId;
};

function hashYmd(ymd: string): number {
  let h = 2166136261;
  for (let i = 0; i < ymd.length; i++) {
    h ^= ymd.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Три разных id из каталога на сутки МСК (ротация в 00:00). */
export function dailyMarketDeals(day = mskYmd()): DailyMarketDeals {
  const pool = [...MARKET_PATCH_ORDER];
  const n = pool.length;
  if (n === 0) {
    throw new Error("empty market catalog");
  }
  if (n === 1) {
    const only = pool[0];
    return { day, discountId: only, markupId: only, sellBoostId: only };
  }

  const h = hashYmd(`bb-market-deal-v2:${day}`);
  // Fisher-Yates с сидом от хэша
  let state = h;
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

export function dailyDealKindFor(
  patchId: string,
  day = mskYmd()
): DailyDealKind {
  const d = dailyMarketDeals(day);
  if (patchId === d.discountId) return "discount";
  if (patchId === d.markupId) return "markup";
  if (patchId === d.sellBoostId) return "sellboost";
  return null;
}

/** Цена купить с учётом дневной акции (скидка/наценка). */
export function patchBuyPriceBbcToday(
  id: ProfilePatchId,
  day = mskYmd()
): number {
  const base = patchBuyPriceBbc(id);
  const kind = dailyDealKindFor(id, day);
  if (kind === "discount") {
    return Math.max(1, Math.round(base * DAILY_DISCOUNT_MULT));
  }
  if (kind === "markup") {
    return Math.max(1, Math.round(base * DAILY_MARKUP_MULT));
  }
  return base;
}

/**
 * Продать = 80% от сегодняшней цены купить;
 * на оружии дня с зелёной лентой — ещё ×1.2.
 */
export function patchSellPriceBbcToday(
  id: ProfilePatchId,
  day = mskYmd()
): number {
  let sell = Math.round(patchBuyPriceBbcToday(id, day) * PATCH_SELL_OF_BUY);
  if (dailyDealKindFor(id, day) === "sellboost") {
    sell = Math.round(sell * DAILY_SELL_BOOST_MULT);
  }
  return Math.max(1, sell);
}
