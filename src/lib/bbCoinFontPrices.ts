/**
 * Центробанк шрифтов ника (BB Coins).
 * Продать = 80% от купить. Дневные акции — bbCoinFontDailyDeals.ts
 */
import {
  PROFILE_NICK_STYLE_OPTIONS,
  type ProfileNickStyleId,
} from "@/lib/profileNickStyles";
import { MARKET_FONT_ORDER, type MarketFontId } from "@/lib/marketFontIds";
import { PATCH_SELL_OF_BUY } from "@/lib/bbCoinPatchPrices";

export { MARKET_FONT_ORDER } from "@/lib/marketFontIds";

export const FONT_MARKET_TITLE: Record<MarketFontId, string> = {
  "bp-l10-aurum-clean": "Aurum Clean",
  "hw2-violet-gothic": "Алая жатва",
};

export const FONT_MARKET_SOURCE: Record<MarketFontId, string> = {
  "bp-l10-aurum-clean": "Battle Pass · L10",
  "hw2-violet-gothic": "Halloween BP S2 · L15",
};

/** Цены купить. */
export const FONT_BUY_PRICES_BBC: Record<MarketFontId, number> = {
  "bp-l10-aurum-clean": 2000,
  "hw2-violet-gothic": 1500,
};

export function fontBuyPriceBbc(id: MarketFontId): number {
  return FONT_BUY_PRICES_BBC[id];
}

export function fontSellPriceBbc(id: MarketFontId): number {
  return Math.round(fontBuyPriceBbc(id) * PATCH_SELL_OF_BUY);
}

export type MarketFontCard = {
  id: MarketFontId;
  title: string;
  source: string;
  cssClass: string;
  sample: string;
  buy: number;
  sell: number;
  buyBase: number;
  mine: number;
  total: number;
  owned: boolean;
  deal: "discount" | "markup" | "sellboost" | null;
  dealDay?: string;
};

export function marketFontMeta(id: MarketFontId) {
  const opt = PROFILE_NICK_STYLE_OPTIONS.find((o) => o.id === id);
  return {
    id,
    title: FONT_MARKET_TITLE[id],
    source: FONT_MARKET_SOURCE[id],
    cssClass: opt?.cssClass || "",
    sample: "Keech",
    buy: fontBuyPriceBbc(id),
    sell: fontSellPriceBbc(id),
    buyBase: fontBuyPriceBbc(id),
  };
}

export type { ProfileNickStyleId };
