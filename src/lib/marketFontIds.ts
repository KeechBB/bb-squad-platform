/**
 * Стили ника в каталоге торговой площадки (зарабатываемые шрифты).
 */
export const MARKET_FONT_ORDER = [
  "bp-l10-aurum-clean",
  "hw2-violet-gothic",
] as const;

export type MarketFontId = (typeof MARKET_FONT_ORDER)[number];

export const MARKET_FONT_IDS = new Set<string>(MARKET_FONT_ORDER);

export function isMarketFontId(id: string): id is MarketFontId {
  return MARKET_FONT_IDS.has(id);
}
