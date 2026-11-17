/**
 * Живые цены площадки: override в БД поверх код-дефолтов.
 * Валюта: BBC (личный баланс) | BD (казна фракции B$).
 */
import { prisma } from "@/lib/prisma";
import { isBuiltinSuperAdmin } from "@/lib/admin";
import { SITE_CREATOR_STEAM_ID } from "@/lib/profileBg";
import { MARKET_PATCH_ORDER } from "@/lib/marketPatchIds";
import { patchBuyPriceBbc, patchSellPriceBbc } from "@/lib/bbCoinPatchPrices";
import { MARKET_BG_ORDER } from "@/lib/marketBgIds";
import { bgBuyPriceBbc, bgSellPriceBbc } from "@/lib/bbCoinBgPrices";
import { MARKET_FONT_ORDER } from "@/lib/marketFontIds";
import { fontBuyPriceBbc, fontSellPriceBbc } from "@/lib/bbCoinFontPrices";
import {
  DAILY_DISCOUNT_MULT,
  DAILY_MARKUP_MULT,
  DAILY_SELL_BOOST_MULT,
  dailyDealKindFor,
} from "@/lib/bbCoinDailyDeals";
import {
  BG_DAILY_DISCOUNT_MULT,
  BG_DAILY_MARKUP_MULT,
  BG_DAILY_SELL_BOOST_MULT,
  dailyBgDealKindFor,
} from "@/lib/bbCoinBgDailyDeals";
import {
  FONT_DAILY_DISCOUNT_MULT,
  FONT_DAILY_MARKUP_MULT,
  FONT_DAILY_SELL_BOOST_MULT,
  dailyFontDealKindFor,
} from "@/lib/bbCoinFontDailyDeals";
import { mskYmd } from "@/lib/eventDay";

export type MarketCatalog = "patch" | "bg" | "font";
export type MarketCurrency = "BBC" | "BD";

export type ResolvedListingPrice = {
  catalog: MarketCatalog;
  itemId: string;
  currency: MarketCurrency;
  buy: number;
  sell: number;
  buyBase: number;
  sellBase: number;
  deal: "discount" | "markup" | "sellboost" | null;
};

type OverrideRow = {
  catalog: string;
  itemId: string;
  currency: string;
  buyPrice: number;
  sellPrice: number;
};

let cache: { at: number; rows: OverrideRow[] } | null = null;
const CACHE_MS = 5_000;

export function canEditMarketPrices(steamId: string | null | undefined): boolean {
  if (!steamId) return false;
  return isBuiltinSuperAdmin(steamId) || steamId === SITE_CREATOR_STEAM_ID;
}

export function isMarketCurrency(v: unknown): v is MarketCurrency {
  return v === "BBC" || v === "BD";
}

export function isMarketCatalog(v: unknown): v is MarketCatalog {
  return v === "patch" || v === "bg" || v === "font";
}

export async function loadListingOverrides(
  force = false
): Promise<Map<string, OverrideRow>> {
  const now = Date.now();
  if (!force && cache && now - cache.at < CACHE_MS) {
    return new Map(cache.rows.map((r) => [`${r.catalog}:${r.itemId}`, r]));
  }
  const rows = await prisma.marketListingPrice.findMany({
    select: {
      catalog: true,
      itemId: true,
      currency: true,
      buyPrice: true,
      sellPrice: true,
    },
  });
  cache = { at: now, rows };
  return new Map(rows.map((r) => [`${r.catalog}:${r.itemId}`, r]));
}

export function invalidateListingPriceCache() {
  cache = null;
}

function codeDefaults(
  catalog: MarketCatalog,
  itemId: string
): { buy: number; sell: number; currency: MarketCurrency } | null {
  if (catalog === "patch") {
    if (!(MARKET_PATCH_ORDER as readonly string[]).includes(itemId)) return null;
    const id = itemId as (typeof MARKET_PATCH_ORDER)[number];
    return {
      buy: patchBuyPriceBbc(id as never),
      sell: patchSellPriceBbc(id as never),
      currency: "BBC",
    };
  }
  if (catalog === "bg") {
    if (!(MARKET_BG_ORDER as readonly string[]).includes(itemId)) return null;
    const id = itemId as (typeof MARKET_BG_ORDER)[number];
    return {
      buy: bgBuyPriceBbc(id),
      sell: bgSellPriceBbc(id),
      currency: "BBC",
    };
  }
  if (!(MARKET_FONT_ORDER as readonly string[]).includes(itemId)) return null;
  const id = itemId as (typeof MARKET_FONT_ORDER)[number];
  return {
    buy: fontBuyPriceBbc(id as never),
    sell: fontSellPriceBbc(id as never),
    currency: "BBC",
  };
}

function applyDeal(
  catalog: MarketCatalog,
  itemId: string,
  buyBase: number,
  sellBase: number,
  day: string
): {
  buy: number;
  sell: number;
  deal: "discount" | "markup" | "sellboost" | null;
} {
  if (catalog === "patch") {
    const deal = dailyDealKindFor(itemId, day);
    let buy = buyBase;
    let sell = sellBase;
    if (deal === "discount") buy = Math.max(1, Math.round(buyBase * DAILY_DISCOUNT_MULT));
    if (deal === "markup") buy = Math.max(1, Math.round(buyBase * DAILY_MARKUP_MULT));
    // sell tracks buy ratio unless sellboost
    if (deal === "discount" || deal === "markup") {
      const ratio = buyBase > 0 ? sellBase / buyBase : 0.8;
      sell = Math.max(1, Math.round(buy * ratio));
    }
    if (deal === "sellboost") {
      sell = Math.max(1, Math.round(sellBase * DAILY_SELL_BOOST_MULT));
    }
    return { buy, sell, deal };
  }
  if (catalog === "bg") {
    const deal = dailyBgDealKindFor(itemId, day);
    let buy = buyBase;
    let sell = sellBase;
    if (deal === "discount")
      buy = Math.max(1, Math.round(buyBase * BG_DAILY_DISCOUNT_MULT));
    if (deal === "markup") buy = Math.max(1, Math.round(buyBase * BG_DAILY_MARKUP_MULT));
    if (deal === "discount" || deal === "markup") {
      const ratio = buyBase > 0 ? sellBase / buyBase : 0.8;
      sell = Math.max(1, Math.round(buy * ratio));
    }
    if (deal === "sellboost") {
      sell = Math.max(1, Math.round(sellBase * BG_DAILY_SELL_BOOST_MULT));
    }
    return { buy, sell, deal };
  }
  const deal = dailyFontDealKindFor(itemId, day);
  let buy = buyBase;
  let sell = sellBase;
  if (deal === "discount")
    buy = Math.max(1, Math.round(buyBase * FONT_DAILY_DISCOUNT_MULT));
  if (deal === "markup") buy = Math.max(1, Math.round(buyBase * FONT_DAILY_MARKUP_MULT));
  if (deal === "discount" || deal === "markup") {
    const ratio = buyBase > 0 ? sellBase / buyBase : 0.8;
    sell = Math.max(1, Math.round(buy * ratio));
  }
  if (deal === "sellboost") {
    sell = Math.max(1, Math.round(sellBase * FONT_DAILY_SELL_BOOST_MULT));
  }
  return { buy, sell, deal };
}

export async function resolveListingPrice(
  catalog: MarketCatalog,
  itemId: string,
  day = mskYmd()
): Promise<ResolvedListingPrice | null> {
  const base = codeDefaults(catalog, itemId);
  if (!base) return null;
  const map = await loadListingOverrides();
  const ov = map.get(`${catalog}:${itemId}`);
  const buyBase = Math.max(1, Math.trunc(ov?.buyPrice ?? base.buy));
  const sellBase = Math.max(1, Math.trunc(ov?.sellPrice ?? base.sell));
  const currency: MarketCurrency =
    ov && isMarketCurrency(ov.currency) ? ov.currency : base.currency;
  const dealt = applyDeal(catalog, itemId, buyBase, sellBase, day);
  return {
    catalog,
    itemId,
    currency,
    buy: dealt.buy,
    sell: dealt.sell,
    buyBase,
    sellBase,
    deal: dealt.deal,
  };
}

export async function upsertListingPrice(opts: {
  catalog: MarketCatalog;
  itemId: string;
  currency: MarketCurrency;
  buyPrice: number;
  sellPrice: number;
  steamId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!canEditMarketPrices(opts.steamId)) return { ok: false, error: "forbidden" };
  if (!codeDefaults(opts.catalog, opts.itemId)) return { ok: false, error: "item" };
  const buy = Math.trunc(Number(opts.buyPrice));
  const sell = Math.trunc(Number(opts.sellPrice));
  if (!Number.isFinite(buy) || buy < 1 || buy > 10_000_000) {
    return { ok: false, error: "buy" };
  }
  if (!Number.isFinite(sell) || sell < 1 || sell > 10_000_000) {
    return { ok: false, error: "sell" };
  }
  if (sell > buy) return { ok: false, error: "sell_gt_buy" };
  await prisma.marketListingPrice.upsert({
    where: {
      catalog_itemId: { catalog: opts.catalog, itemId: opts.itemId },
    },
    create: {
      catalog: opts.catalog,
      itemId: opts.itemId,
      currency: opts.currency,
      buyPrice: buy,
      sellPrice: sell,
      updatedBySteamId: opts.steamId,
    },
    update: {
      currency: opts.currency,
      buyPrice: buy,
      sellPrice: sell,
      updatedBySteamId: opts.steamId,
    },
  });
  invalidateListingPriceCache();
  return { ok: true };
}

export function currencyLabel(c: MarketCurrency): string {
  return c === "BD" ? "B$" : "BBC";
}
