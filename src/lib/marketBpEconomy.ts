/**
 * Экономика BP-шмоток на площадке:
 * — текущий Battle Pass = 100% базы;
 * — предыдущий = 200%, ещё старше = 300% и т.д.;
 * — редкость: чем меньше копий у игроков, тем дороже (до ×2).
 *
 * При новом сезоне добавь id в BP_MARKET_SEASONS (в конец = текущий)
 * и пропиши item → season в BP_ITEM_SEASON.
 */
import { prisma } from "@/lib/prisma";

/** Сезоны от старого к новому. Последний = текущий. */
export const BP_MARKET_SEASONS = ["classic", "hw2"] as const;

export type BpMarketSeasonId = (typeof BP_MARKET_SEASONS)[number];

/** При каком числе копий редкость = 1× (больше — тоже 1×). */
export const BP_SCARCITY_REF_SUPPLY = 20;
/** Потолок множителя редкости. */
export const BP_SCARCITY_MAX = 2;

/** Шмотки Battle Pass → сезон. */
export const BP_ITEM_SEASON: Readonly<Record<string, BpMarketSeasonId>> = {
  // Classic / PB1
  "bp-l15-keech": "classic",
  "bp-l5-gold": "classic",
  "bp-l10-aurum-clean": "classic",
  // Halloween BP S2 (текущий)
  "hw2-knife-hook": "hw2",
  "hw2-ak-pumpkin": "hw2",
  "hw2-night-harvest": "hw2",
  "hw2-violet-gothic": "hw2",
};

export function isBpMarketItem(itemId: string): boolean {
  return Boolean(BP_ITEM_SEASON[itemId]);
}

export function currentBpMarketSeason(): BpMarketSeasonId {
  return BP_MARKET_SEASONS[BP_MARKET_SEASONS.length - 1];
}

/** 1 = текущий, 2 = прошлый, 3 = предпрошлый… */
export function bpAgeMultiplier(itemId: string): number {
  const season = BP_ITEM_SEASON[itemId];
  if (!season) return 1;
  const idx = BP_MARKET_SEASONS.indexOf(season);
  if (idx < 0) return 1;
  const cur = BP_MARKET_SEASONS.length - 1;
  return Math.max(1, cur - idx + 1);
}

export function bpScarcityMultiplier(totalSupply: number): number {
  const n = Math.max(0, Math.trunc(totalSupply));
  if (n >= BP_SCARCITY_REF_SUPPLY) return 1;
  return Math.min(BP_SCARCITY_MAX, BP_SCARCITY_REF_SUPPLY / Math.max(1, n));
}

export function applyBpEconomy(opts: {
  itemId: string;
  buyBase: number;
  totalSupply: number;
}): { buy: number; ageMult: number; scarcityMult: number } {
  if (!isBpMarketItem(opts.itemId)) {
    return { buy: opts.buyBase, ageMult: 1, scarcityMult: 1 };
  }
  const ageMult = bpAgeMultiplier(opts.itemId);
  const scarcityMult = bpScarcityMultiplier(opts.totalSupply);
  const buy = Math.max(
    1,
    Math.round(opts.buyBase * ageMult * scarcityMult)
  );
  return { buy, ageMult, scarcityMult };
}

type SupplyCache = { at: number; byKey: Map<string, number> };
let supplyCache: SupplyCache | null = null;
const SUPPLY_CACHE_MS = 10_000;

function cacheKey(catalog: "patch" | "bg" | "font", itemId: string): string {
  return `${catalog}:${itemId}`;
}

export function invalidateBpSupplyCache() {
  supplyCache = null;
}

async function loadBpSupplyMap(
  force = false
): Promise<Map<string, number>> {
  const now = Date.now();
  if (
    !force &&
    supplyCache &&
    now - supplyCache.at < SUPPLY_CACHE_MS
  ) {
    return supplyCache.byKey;
  }
  const bpIds = Object.keys(BP_ITEM_SEASON);
  const byKey = new Map<string, number>();
  for (const id of bpIds) byKey.set(cacheKey("patch", id), 0);
  for (const id of bpIds) byKey.set(cacheKey("bg", id), 0);
  for (const id of bpIds) byKey.set(cacheKey("font", id), 0);

  const [patches, bgs, fonts] = await Promise.all([
    prisma.nickPatchStock.groupBy({
      by: ["patchId"],
      where: { patchId: { in: bpIds }, qty: { gt: 0 } },
      _sum: { qty: true },
    }),
    prisma.profileBgStock.groupBy({
      by: ["bgId"],
      where: { bgId: { in: bpIds }, qty: { gt: 0 } },
      _sum: { qty: true },
    }),
    prisma.nickStyleStock.groupBy({
      by: ["styleId"],
      where: { styleId: { in: bpIds }, qty: { gt: 0 } },
      _sum: { qty: true },
    }),
  ]);

  for (const r of patches) {
    byKey.set(cacheKey("patch", r.patchId), Math.max(0, r._sum.qty || 0));
  }
  for (const r of bgs) {
    byKey.set(cacheKey("bg", r.bgId), Math.max(0, r._sum.qty || 0));
  }
  for (const r of fonts) {
    byKey.set(cacheKey("font", r.styleId), Math.max(0, r._sum.qty || 0));
  }

  supplyCache = { at: now, byKey };
  return byKey;
}

export async function getBpItemSupply(
  catalog: "patch" | "bg" | "font",
  itemId: string
): Promise<number> {
  if (!isBpMarketItem(itemId)) return 0;
  const map = await loadBpSupplyMap();
  return map.get(cacheKey(catalog, itemId)) ?? 0;
}
