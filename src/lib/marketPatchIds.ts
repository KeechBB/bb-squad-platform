/**
 * Id нашивок в каталоге торговой площадки.
 * Владение = только unlockedNickPatches; продажа снимает id.
 */
export const MARKET_PATCH_ORDER = [
  "bp-l15-keech",
  "creator-orange-phantom",
  "creator-fruit-strike-ak-v2",
  "creator-svd-faction-lord",
  "creator-gp-drum-berry-lore",
  "hw2-knife-hook",
  "hw2-ak-pumpkin",
  "creator-event-scar-lemon",
  "creator-event-saiga-apple",
  "public-100-vehicles-t62",
  "bd-faction-legion-ak74",
  "bd-faction-orda-m4a1",
  "bd-faction-sbord-scar",
  "bd-faction-staya-svd",
  "bd-faction-tabor-m4",
  "bd-faction-uley-pkm",
] as const;

export type MarketPatchId = (typeof MARKET_PATCH_ORDER)[number];

export const MARKET_PATCH_IDS = new Set<string>(MARKET_PATCH_ORDER);

/** Только продажа в центробанк: купить недоступно (дроп из кейсов). */
export const MARKET_SELL_ONLY_PATCH_IDS = new Set<string>([
  "creator-svd-faction-lord",
  "creator-gp-drum-berry-lore",
]);

export function isMarketPatchId(id: string): id is MarketPatchId {
  return MARKET_PATCH_IDS.has(id);
}

export function isMarketSellOnlyPatch(id: string): boolean {
  return MARKET_SELL_ONLY_PATCH_IDS.has(id);
}
