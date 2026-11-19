/**
 * Центробанк нашивок: цена «купить» в BB Coins.
 * Продать = 80% от купить (SELL_OF_BUY).
 * Канон: docs/PATCH-MARKETPLACE-CANON.md, .cursor/rules/bb-coins-patch-prices.mdc
 */
import { PROFILE_PATCH_OPTIONS, profilePatchUrl } from "@/lib/profilePatches";
import {
  MARKET_PATCH_ORDER,
  type MarketPatchId,
} from "@/lib/marketPatchIds";

export { MARKET_PATCH_ORDER } from "@/lib/marketPatchIds";

/** Доля скупки от цены покупки. */
export const PATCH_SELL_OF_BUY = 0.8;

/** Короткое имя на карточке (без источника). */
export const PATCH_MARKET_TITLE: Record<MarketPatchId, string> = {
  "bp-l15-keech": "M4A1 «Золотой стандарт»",
  "creator-orange-phantom": "Протокол: Оранжевый призрак",
  "creator-fruit-strike-ak-v2": "АК «Цитрусовый шторм»",
  "creator-svd-faction-lord": "СВД «Повелитель фракций»",
  "creator-gp-drum-berry-lore": "РГ-6 «Ягодный барабан»",
  "creator-rpg7-orchard-harvest": "РПГ-7 «Урожайный удар»",
  "hw2-knife-hook": "Крюк «Жнец сада»",
  "hw2-ak-pumpkin": "АК «Тыквенный магазин»",
  "creator-event-scar-lemon": "АК-74 «Лимонный шквал»",
  "creator-event-saiga-apple": "АК-74 «Яблочный разброс»",
  "public-100-vehicles-t62": "Т-62 «Неоновый урожай»",
  "bd-faction-legion-ak74": "M4A1 «Орёл Легиона»",
  "bd-faction-orda-m4a1": "АК-74 «Клык Орды»",
  "bd-faction-sbord-scar": "FN FAL «Скрап-протокол»",
  "bd-faction-staya-svd": "AK-12 «Лунная Стая»",
  "bd-faction-tabor-m4": "AKM «Золото Табора»",
  "bd-faction-uley-pkm": "QBZ-191 «Янтарь Улья»",
};

/** Откуда награда (подпись под названием). */
export const PATCH_MARKET_SOURCE: Record<MarketPatchId, string> = {
  "bp-l15-keech": "Battle Pass · L15",
  "creator-orange-phantom": "Скрытая награда",
  "creator-fruit-strike-ak-v2": "Турнир Fruit Strike · 2 место",
  "creator-svd-faction-lord": "Кейс Сада · 0.01%",
  "creator-gp-drum-berry-lore": "Кейс Сада · 0.01%",
  "creator-rpg7-orchard-harvest": "Кейс Жатва · 0.05%",
  "hw2-knife-hook": "Halloween BP S2 · L5",
  "hw2-ak-pumpkin": "Halloween BP S2 · L20",
  "creator-event-scar-lemon": "Ивент дня · 50 ресов",
  "creator-event-saiga-apple": "Ивент дня · 100 киллов",
  "public-100-vehicles-t62": "Паблик · 100 техники",
  "bd-faction-legion-ak74": "$ · Фракция Легион",
  "bd-faction-orda-m4a1": "$ · Фракция Орда",
  "bd-faction-sbord-scar": "$ · Фракция Сброд",
  "bd-faction-staya-svd": "$ · Фракция Стая",
  "bd-faction-tabor-m4": "$ · Фракция Табор",
  "bd-faction-uley-pkm": "$ · Фракция Улей",
};

/** Цена «купить» (BBC или $, см. patchDefaultCurrency). Sell = 80%. */
export const PATCH_BUY_PRICES_BBC: Record<MarketPatchId, number> = {
  "bp-l15-keech": 4000,
  "creator-orange-phantom": 4500,
  "creator-fruit-strike-ak-v2": 1800,
  /** Купить недоступно; sell = 50 000 BBC. */
  "creator-svd-faction-lord": 62_500,
  /** Купить недоступно; sell = 40 000 BBC. */
  "creator-gp-drum-berry-lore": 50_000,
  /** Купить недоступно; sell = 35 000 $ (B$). */
  "creator-rpg7-orchard-harvest": 43_750,
  "hw2-knife-hook": 300,
  "hw2-ak-pumpkin": 1200,
  "creator-event-scar-lemon": 500,
  "creator-event-saiga-apple": 500,
  "public-100-vehicles-t62": 500,
  "bd-faction-legion-ak74": 10_000,
  "bd-faction-orda-m4a1": 10_000,
  "bd-faction-sbord-scar": 10_000,
  "bd-faction-staya-svd": 10_000,
  "bd-faction-tabor-m4": 10_000,
  "bd-faction-uley-pkm": 10_000,
};

/** Валюта по умолчанию: фракционные нашивки — казна ($). */
export function patchDefaultCurrency(id: MarketPatchId): "BBC" | "BD" {
  if (id.startsWith("bd-faction-") || id === "creator-rpg7-orchard-harvest") {
    return "BD";
  }
  return "BBC";
}

export function patchBuyPriceBbc(id: MarketPatchId): number {
  return PATCH_BUY_PRICES_BBC[id];
}

export function patchSellPriceBbc(id: MarketPatchId): number {
  return Math.round(patchBuyPriceBbc(id) * PATCH_SELL_OF_BUY);
}

export type MarketPatchCard = {
  id: MarketPatchId;
  title: string;
  source: string;
  image: string;
  buy: number;
  sell: number;
  /** Базовая цена купить без дневной акции */
  buyBase: number;
  sellBase?: number;
  /** Сколько копий у текущего игрока */
  mine: number;
  /** Сколько копий всего у всех на площадке */
  total: number;
  owned: boolean;
  /** Дневная акция: скидка / наценка купить / бонус продажи */
  deal: "discount" | "markup" | "sellboost" | null;
  dealDay?: string;
  currency: "BBC" | "BD";
  /** Только продажа — кнопка купить неактивна. */
  buyDisabled?: boolean;
};

export function marketPatchMeta(id: MarketPatchId) {
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
