/**
 * Центробанк нашивок: цена «купить» в BB Coins.
 * Продать = 80% от купить (SELL_OF_BUY).
 * Канон: docs/PATCH-MARKETPLACE-CANON.md, .cursor/rules/bb-coins-patch-prices.mdc
 */
import type { ProfilePatchId } from "@/lib/profilePatches";
import { PROFILE_PATCH_OPTIONS, profilePatchUrl } from "@/lib/profilePatches";
import { MARKET_PATCH_ORDER } from "@/lib/marketPatchIds";

export { MARKET_PATCH_ORDER } from "@/lib/marketPatchIds";

/** Доля скупки от цены покупки. */
export const PATCH_SELL_OF_BUY = 0.8;

/** Короткое имя на карточке (без источника). */
export const PATCH_MARKET_TITLE: Record<ProfilePatchId, string> = {
  "bp-l15-keech": "M4A1 «Золотой стандарт»",
  "creator-orange-phantom": "Протокол: Оранжевый призрак",
  "creator-fruit-strike-ak-v2": "АК «Цитрусовый шторм»",
  "hw2-knife-hook": "Крюк «Жнец сада»",
  "hw2-ak-pumpkin": "АК «Тыквенный магазин»",
  "creator-event-scar-lemon": "АК-74 «Лимонный шквал»",
  "creator-event-saiga-apple": "АК-74 «Яблочный разброс»",
  "public-100-vehicles-t62": "Т-62 «Неоновый урожай»",
};

/** Откуда награда (подпись под названием). */
export const PATCH_MARKET_SOURCE: Record<ProfilePatchId, string> = {
  "bp-l15-keech": "Battle Pass · L15",
  "creator-orange-phantom": "Скрытая награда",
  "creator-fruit-strike-ak-v2": "Турнир Fruit Strike · 2 место",
  "hw2-knife-hook": "Halloween BP S2 · L5",
  "hw2-ak-pumpkin": "Halloween BP S2 · L20",
  "creator-event-scar-lemon": "Ивент дня · 50 ресов",
  "creator-event-saiga-apple": "Ивент дня · 100 киллов",
  "public-100-vehicles-t62": "Паблик · 100 техники",
};

/** Цена «купить» (BBC) по id нашивки. */
export const PATCH_BUY_PRICES_BBC: Record<ProfilePatchId, number> = {
  "bp-l15-keech": 4000,
  "creator-orange-phantom": 4500,
  "creator-fruit-strike-ak-v2": 1800,
  "hw2-knife-hook": 300,
  "hw2-ak-pumpkin": 600,
  "creator-event-scar-lemon": 500,
  "creator-event-saiga-apple": 500,
  "public-100-vehicles-t62": 500,
};

export function patchBuyPriceBbc(id: ProfilePatchId): number {
  return PATCH_BUY_PRICES_BBC[id];
}

export function patchSellPriceBbc(id: ProfilePatchId): number {
  return Math.round(patchBuyPriceBbc(id) * PATCH_SELL_OF_BUY);
}

export type MarketPatchCard = {
  id: ProfilePatchId;
  title: string;
  source: string;
  image: string;
  buy: number;
  sell: number;
  /** Базовая цена купить без дневной акции */
  buyBase: number;
  /** Сколько копий у текущего игрока */
  mine: number;
  /** Сколько копий всего у всех на площадке */
  total: number;
  owned: boolean;
  /** Дневная акция: скидка / наценка купить / бонус продажи */
  deal: "discount" | "markup" | "sellboost" | null;
  dealDay?: string;
};

export function marketPatchMeta(id: ProfilePatchId) {
  const opt = PROFILE_PATCH_OPTIONS.find((o) => o.id === id);
  return {
    id,
    title: PATCH_MARKET_TITLE[id],
    source: PATCH_MARKET_SOURCE[id],
    image: profilePatchUrl(id) || (opt ? `/bp-assets/${opt.file}` : ""),
    buy: patchBuyPriceBbc(id),
    sell: patchSellPriceBbc(id),
    buyBase: patchBuyPriceBbc(id),
  };
}
