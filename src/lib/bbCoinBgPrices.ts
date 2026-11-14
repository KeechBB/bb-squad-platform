/**
 * Центробанк фонов профиля (BB Coins).
 * Продать = 80% от купить. Дневные акции — bbCoinBgDailyDeals.ts
 */
import type { ProfileBgId } from "@/lib/profileBg";
import { PROFILE_BG_OPTIONS, profileBgUrl } from "@/lib/profileBg";
import { MARKET_BG_ORDER, type MarketBgId } from "@/lib/marketBgIds";
import { PATCH_SELL_OF_BUY } from "@/lib/bbCoinPatchPrices";

export { MARKET_BG_ORDER } from "@/lib/marketBgIds";

export const BG_MARKET_TITLE: Record<MarketBgId, string> = {
  "bp-l5-gold": "Турнирное золото II",
  "hw2-night-harvest": "Ночной урожай",
  "creator-fruit-strike-place3-v3": "Тактический урожай",
  "creator-royal-core": "BlackBerry Royal Core",
};

export const BG_MARKET_SOURCE: Record<MarketBgId, string> = {
  "bp-l5-gold": "Battle Pass · L5",
  "hw2-night-harvest": "Halloween BP S2",
  "creator-fruit-strike-place3-v3": "Турнир Fruit Strike · 3 место",
  "creator-royal-core": "Скрытая награда",
};

/** Цены купить — редкость / способ получения. */
export const BG_BUY_PRICES_BBC: Record<MarketBgId, number> = {
  "bp-l5-gold": 600,
  "hw2-night-harvest": 900,
  "creator-fruit-strike-place3-v3": 1200,
  "creator-royal-core": 2800,
};

export function bgBuyPriceBbc(id: MarketBgId): number {
  return BG_BUY_PRICES_BBC[id];
}

export function bgSellPriceBbc(id: MarketBgId): number {
  return Math.round(bgBuyPriceBbc(id) * PATCH_SELL_OF_BUY);
}

export type MarketBgCard = {
  id: MarketBgId;
  title: string;
  source: string;
  image: string;
  buy: number;
  sell: number;
  buyBase: number;
  mine: number;
  total: number;
  owned: boolean;
  deal: "discount" | "markup" | "sellboost" | null;
  dealDay?: string;
};

export function marketBgMeta(id: MarketBgId) {
  const opt = PROFILE_BG_OPTIONS.find((o) => o.id === id);
  return {
    id,
    title: BG_MARKET_TITLE[id],
    source: BG_MARKET_SOURCE[id],
    image:
      profileBgUrl(id as ProfileBgId) ||
      (opt ? `/profile-bgs/${opt.file}` : ""),
    buy: bgBuyPriceBbc(id),
    sell: bgSellPriceBbc(id),
    buyBase: bgBuyPriceBbc(id),
  };
}
