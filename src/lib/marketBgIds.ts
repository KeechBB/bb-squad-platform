/**
 * Фоны профиля в каталоге торговой площадки (только зарабатываемые, не free 02/06).
 */
export const MARKET_BG_ORDER = [
  "bp-l5-gold",
  "hw2-night-harvest",
  "creator-fruit-strike-place3-v3",
  "creator-royal-core",
  "bd-faction-uley-bg",
  "bd-faction-orda-bg",
  "bd-faction-staya-bg",
  "bd-faction-legion-bg",
  "bd-faction-sbord-bg",
  "bd-faction-tabor-bg",
] as const;

export type MarketBgId = (typeof MARKET_BG_ORDER)[number];

export const MARKET_BG_IDS = new Set<string>(MARKET_BG_ORDER);

export function isMarketBgId(id: string): id is MarketBgId {
  return MARKET_BG_IDS.has(id);
}
