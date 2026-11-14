import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/requireAdmin";
import { PATCH_MARKET_TITLE } from "@/lib/bbCoinPatchPrices";
import { BG_MARKET_TITLE } from "@/lib/bbCoinBgPrices";
import { FONT_MARKET_TITLE } from "@/lib/bbCoinFontPrices";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MARKET_KINDS = [
  "patch_buy",
  "patch_sell",
  "bg_buy",
  "bg_sell",
  "font_buy",
  "font_sell",
] as const;

type MarketKind = (typeof MARKET_KINDS)[number];

function isMarketKind(v: string): v is MarketKind {
  return (MARKET_KINDS as readonly string[]).includes(v);
}

function parseItemId(kind: MarketKind, note: string | null, ref: string | null): string {
  const fromNote = /(?:нашивки|фона|шрифта)\s+(\S+)/u.exec(String(note || ""));
  if (fromNote?.[1]) return fromNote[1];
  if (ref && (kind.endsWith("_sell") || kind.endsWith("_buy"))) {
    const id = String(ref).split(":")[0]?.trim();
    if (id) return id;
  }
  return "";
}

function itemTitle(kind: MarketKind, itemId: string): string {
  if (!itemId) return "—";
  if (kind.startsWith("patch_")) {
    return (
      PATCH_MARKET_TITLE[itemId as keyof typeof PATCH_MARKET_TITLE] || itemId
    );
  }
  if (kind.startsWith("bg_")) {
    return BG_MARKET_TITLE[itemId as keyof typeof BG_MARKET_TITLE] || itemId;
  }
  if (kind.startsWith("font_")) {
    return FONT_MARKET_TITLE[itemId as keyof typeof FONT_MARKET_TITLE] || itemId;
  }
  return itemId;
}

function catalogLabel(kind: MarketKind): "нашивка" | "фон" | "шрифт" {
  if (kind.startsWith("bg_")) return "фон";
  if (kind.startsWith("font_")) return "шрифт";
  return "нашивка";
}

export async function GET(req: Request) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;

  const url = new URL(req.url);
  const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
  const side = String(url.searchParams.get("side") || "").trim(); // buy | sell | ""
  const catalog = String(url.searchParams.get("catalog") || "").trim(); // patch | bg | font | ""
  const limitRaw = Number(url.searchParams.get("limit") || "300");
  const limit = Math.min(
    1000,
    Math.max(20, Number.isFinite(limitRaw) ? limitRaw : 300)
  );
  const before = String(url.searchParams.get("before") || "").trim();

  let kinds: MarketKind[] = [...MARKET_KINDS];
  if (side === "buy") kinds = kinds.filter((k) => k.endsWith("_buy"));
  if (side === "sell") kinds = kinds.filter((k) => k.endsWith("_sell"));
  if (catalog === "patch") kinds = kinds.filter((k) => k.startsWith("patch_"));
  if (catalog === "bg") kinds = kinds.filter((k) => k.startsWith("bg_"));
  if (catalog === "font") kinds = kinds.filter((k) => k.startsWith("font_"));

  const where: {
    kind: { in: MarketKind[] };
    createdAt?: { lt: Date };
  } = { kind: { in: kinds } };

  if (before) {
    const d = new Date(before);
    if (!Number.isNaN(d.getTime())) where.createdAt = { lt: d };
  }

  const rows = await prisma.bbCoinTx.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      kind: true,
      delta: true,
      balanceAfter: true,
      note: true,
      ref: true,
      createdAt: true,
      user: { select: { nick: true, steamName: true, steamId: true } },
    },
  });

  const entries = rows
    .filter((r) => isMarketKind(r.kind))
    .map((r) => {
      const kind = r.kind as MarketKind;
      const itemId = parseItemId(kind, r.note, r.ref);
      const deal =
        /·\s*(скидка −20%|наценка \+20%|продажа \+20%)/u.exec(
          String(r.note || "")
        )?.[1] || null;
      return {
        id: r.id,
        at: r.createdAt.toISOString(),
        nick: r.user.nick || r.user.steamName || "—",
        steamId: r.user.steamId,
        side: kind.endsWith("_buy") ? ("buy" as const) : ("sell" as const),
        catalog: catalogLabel(kind),
        itemId,
        itemTitle: itemTitle(kind, itemId),
        priceBbc: Math.abs(r.delta),
        balanceAfter: r.balanceAfter,
        deal,
        note: r.note,
      };
    })
    .filter((e) => {
      if (!q) return true;
      const hay = `${e.nick} ${e.itemId} ${e.itemTitle} ${e.note || ""}`.toLowerCase();
      return hay.includes(q);
    });

  return NextResponse.json({
    ok: true,
    entries,
    hasMore: rows.length >= limit,
  });
}
