import { NextResponse } from "next/server";
import { requireMarketUser } from "@/lib/bbCoinMarketAuth";
import {
  canEditMarketPrices,
  isMarketCatalog,
  isMarketCurrency,
  resolveListingPrice,
  upsertListingPrice,
  type MarketCatalog,
} from "@/lib/marketListingPrices";
import { MARKET_PATCH_ORDER } from "@/lib/marketPatchIds";
import { MARKET_BG_ORDER } from "@/lib/marketBgIds";
import { MARKET_FONT_ORDER } from "@/lib/marketFontIds";

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireMarketUser();
  if ("error" in gate) return gate.error;
  const { user } = gate;
  const canEdit = canEditMarketPrices(user.steamId);

  const listings: Array<{
    catalog: MarketCatalog;
    itemId: string;
    currency: string;
    buy: number;
    sell: number;
    buyBase: number;
    sellBase: number;
  }> = [];

  for (const id of MARKET_PATCH_ORDER) {
    const p = await resolveListingPrice("patch", id);
    if (p)
      listings.push({
        catalog: "patch",
        itemId: id,
        currency: p.currency,
        buy: p.buy,
        sell: p.sell,
        buyBase: p.buyBase,
        sellBase: p.sellBase,
      });
  }
  for (const id of MARKET_BG_ORDER) {
    const p = await resolveListingPrice("bg", id);
    if (p)
      listings.push({
        catalog: "bg",
        itemId: id,
        currency: p.currency,
        buy: p.buy,
        sell: p.sell,
        buyBase: p.buyBase,
        sellBase: p.sellBase,
      });
  }
  for (const id of MARKET_FONT_ORDER) {
    const p = await resolveListingPrice("font", id);
    if (p)
      listings.push({
        catalog: "font",
        itemId: id,
        currency: p.currency,
        buy: p.buy,
        sell: p.sell,
        buyBase: p.buyBase,
        sellBase: p.sellBase,
      });
  }

  return NextResponse.json({ ok: true, canEdit, listings });
}

export async function POST(req: Request) {
  const gate = await requireMarketUser();
  if ("error" in gate) return gate.error;
  const { user } = gate;
  if (!canEditMarketPrices(user.steamId)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    catalog?: string;
    itemId?: string;
    currency?: string;
    buyPrice?: number;
    sellPrice?: number;
  };

  if (!isMarketCatalog(body.catalog)) {
    return NextResponse.json({ ok: false, error: "catalog" }, { status: 400 });
  }
  if (!isMarketCurrency(body.currency)) {
    return NextResponse.json({ ok: false, error: "currency" }, { status: 400 });
  }
  const itemId = String(body.itemId || "");
  if (!itemId) {
    return NextResponse.json({ ok: false, error: "item" }, { status: 400 });
  }

  const res = await upsertListingPrice({
    catalog: body.catalog,
    itemId,
    currency: body.currency,
    buyPrice: Number(body.buyPrice),
    sellPrice: Number(body.sellPrice),
    steamId: user.steamId,
  });
  if (!res.ok) {
    return NextResponse.json(res, { status: 400 });
  }
  const resolved = await resolveListingPrice(body.catalog, itemId);
  return NextResponse.json({ ok: true, listing: resolved });
}
