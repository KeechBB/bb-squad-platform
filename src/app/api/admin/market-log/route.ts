import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/requireAdmin";
import { PATCH_MARKET_TITLE } from "@/lib/bbCoinPatchPrices";
import { BG_MARKET_TITLE } from "@/lib/bbCoinBgPrices";
import { FONT_MARKET_TITLE } from "@/lib/bbCoinFontPrices";
import { BD_MARK } from "@/lib/blueberryDollar";

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
type Currency = "BBC" | typeof BD_MARK;

function isMarketKind(v: string): v is MarketKind {
  return (MARKET_KINDS as readonly string[]).includes(v);
}

function parseItemId(
  kind: MarketKind,
  note: string | null,
  ref: string | null
): string {
  const fromNote = /(?:нашивки|фона|шрифта)\s+(\S+)/u.exec(String(note || ""));
  if (fromNote?.[1]) return fromNote[1].replace(/→.*$/, "").trim();
  if (ref && (kind.endsWith("_sell") || kind.endsWith("_buy"))) {
    const id = String(ref).split(":")[0]?.trim();
    if (id) return id;
  }
  return "";
}

/** sourceKey: market_buy:patch_buy:userId:itemId:ts */
function parseFactionSource(sourceKey: string): {
  side: "buy" | "sell";
  kind: MarketKind | null;
  itemId: string;
} | null {
  const m =
    /^(market_buy|market_sell):(patch|bg|font)_(buy|sell):[^:]+:([^:]+):/u.exec(
      sourceKey || ""
    );
  if (!m) return null;
  const side = m[1] === "market_buy" ? ("buy" as const) : ("sell" as const);
  const kind = `${m[2]}_${m[3]}` as MarketKind;
  return { side, kind: isMarketKind(kind) ? kind : null, itemId: m[4] };
}

function itemTitle(kind: MarketKind | null, itemId: string): string {
  if (!itemId) return "—";
  if (!kind) return itemId;
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

function catalogLabel(
  kind: MarketKind | null
): "нашивка" | "фон" | "шрифт" | "—" {
  if (!kind) return "—";
  if (kind.startsWith("bg_")) return "фон";
  if (kind.startsWith("font_")) return "шрифт";
  return "нашивка";
}

function kindFromCatalogFilters(side: string, catalog: string): MarketKind[] {
  let kinds: MarketKind[] = [...MARKET_KINDS];
  if (side === "buy") kinds = kinds.filter((k) => k.endsWith("_buy"));
  if (side === "sell") kinds = kinds.filter((k) => k.endsWith("_sell"));
  if (catalog === "patch") kinds = kinds.filter((k) => k.startsWith("patch_"));
  if (catalog === "bg") kinds = kinds.filter((k) => k.startsWith("bg_"));
  if (catalog === "font") kinds = kinds.filter((k) => k.startsWith("font_"));
  return kinds;
}

type Entry = {
  id: string;
  at: string;
  nick: string;
  steamId: string;
  side: "buy" | "sell";
  catalog: "нашивка" | "фон" | "шрифт" | "—";
  itemId: string;
  itemTitle: string;
  price: number;
  currency: Currency;
  balanceAfter: number | null;
  deal: string | null;
  note: string | null;
  factionName: string | null;
};

export async function GET(req: Request) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;

  const url = new URL(req.url);
  const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
  const side = String(url.searchParams.get("side") || "").trim();
  const catalog = String(url.searchParams.get("catalog") || "").trim();
  const limitRaw = Number(url.searchParams.get("limit") || "300");
  const limit = Math.min(
    1000,
    Math.max(20, Number.isFinite(limitRaw) ? limitRaw : 300)
  );
  const before = String(url.searchParams.get("before") || "").trim();

  const kinds = kindFromCatalogFilters(side, catalog);
  const beforeDate = before ? new Date(before) : null;
  const beforeOk =
    beforeDate && !Number.isNaN(beforeDate.getTime()) ? beforeDate : null;

  const takeEach = Math.min(1000, limit * 2);

  const bbcWhere: {
    kind: { in: MarketKind[] };
    createdAt?: { lt: Date };
  } = { kind: { in: kinds } };
  if (beforeOk) bbcWhere.createdAt = { lt: beforeOk };

  const factionKinds: string[] = [];
  if (!side || side === "buy") factionKinds.push("market_buy");
  if (!side || side === "sell") factionKinds.push("market_sell");

  const [bbcRows, factionRows] = await Promise.all([
    prisma.bbCoinTx.findMany({
      where: bbcWhere,
      orderBy: { createdAt: "desc" },
      take: takeEach,
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
    }),
    factionKinds.length
      ? prisma.factionLedgerEntry.findMany({
          where: {
            kind: { in: factionKinds },
            ...(beforeOk ? { createdAt: { lt: beforeOk } } : {}),
          },
          orderBy: { createdAt: "desc" },
          take: takeEach,
          select: {
            id: true,
            amount: true,
            kind: true,
            sourceKey: true,
            note: true,
            createdAt: true,
            userId: true,
            faction: { select: { name: true, slug: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  const bdUserIds = [
    ...new Set(
      factionRows
        .map((r) => r.userId)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const bdUsers = bdUserIds.length
    ? await prisma.user.findMany({
        where: { id: { in: bdUserIds } },
        select: { id: true, nick: true, steamName: true, steamId: true },
      })
    : [];
  const bdUserById = new Map(bdUsers.map((u) => [u.id, u]));

  const bbcEntries: Entry[] = bbcRows
    .filter((r) => isMarketKind(r.kind))
    .map((r) => {
      const kind = r.kind as MarketKind;
      const itemId = parseItemId(kind, r.note, r.ref);
      const deal =
        /·\s*(скидка −20%|наценка \+20%|продажа \+20%)/u.exec(
          String(r.note || "")
        )?.[1] || null;
      return {
        id: `bbc:${r.id}`,
        at: r.createdAt.toISOString(),
        nick: r.user.nick || r.user.steamName || "—",
        steamId: r.user.steamId,
        side: kind.endsWith("_buy") ? ("buy" as const) : ("sell" as const),
        catalog: catalogLabel(kind),
        itemId,
        itemTitle: itemTitle(kind, itemId),
        price: Math.abs(r.delta),
        currency: "BBC" as const,
        balanceAfter: r.balanceAfter,
        deal,
        note: r.note,
        factionName: null,
      };
    });

  const bdEntries: Entry[] = [];
  for (const r of factionRows) {
    const parsed = parseFactionSource(r.sourceKey);
    let kind: MarketKind | null = parsed?.kind || null;
    let itemId = parsed?.itemId || "";
    if (!itemId) {
      const fromNote = /(?:нашивки|фона|шрифта)\s+(\S+)/u.exec(
        String(r.note || "")
      );
      if (fromNote?.[1]) {
        itemId = fromNote[1].replace(/→.*$/, "").trim();
      }
    }
    if (!kind) {
      if (catalog === "bg" || /фона\s+/u.test(String(r.note || ""))) {
        kind = r.kind === "market_buy" ? "bg_buy" : "bg_sell";
      } else if (
        catalog === "font" ||
        /шрифта\s+/u.test(String(r.note || ""))
      ) {
        kind = r.kind === "market_buy" ? "font_buy" : "font_sell";
      } else {
        kind = r.kind === "market_buy" ? "patch_buy" : "patch_sell";
      }
    }
    if (catalog === "patch" && !kind.startsWith("patch_")) continue;
    if (catalog === "bg" && !kind.startsWith("bg_")) continue;
    if (catalog === "font" && !kind.startsWith("font_")) continue;

    const deal =
      /·\s*(скидка −20%|наценка \+20%|продажа \+20%)/u.exec(
        String(r.note || "")
      )?.[1] || null;
    const u = r.userId ? bdUserById.get(r.userId) : null;

    bdEntries.push({
      id: `bd:${r.id}`,
      at: r.createdAt.toISOString(),
      nick: u?.nick || u?.steamName || "—",
      steamId: u?.steamId || "",
      side: r.kind === "market_buy" ? "buy" : "sell",
      catalog: catalogLabel(kind),
      itemId,
      itemTitle: itemTitle(kind, itemId),
      price: Math.abs(r.amount),
      currency: BD_MARK,
      balanceAfter: null,
      deal,
      note: r.note,
      factionName: r.faction?.name || null,
    });
  }

  const merged = [...bbcEntries, ...bdEntries].sort((a, b) =>
    a.at < b.at ? 1 : a.at > b.at ? -1 : 0
  );

  const entries = merged
    .filter((e) => {
      if (!q) return true;
      const hay =
        `${e.nick} ${e.itemId} ${e.itemTitle} ${e.note || ""} ${e.factionName || ""}`.toLowerCase();
      return hay.includes(q);
    })
    .slice(0, limit);

  return NextResponse.json({
    ok: true,
    entries,
    hasMore: merged.length >= limit,
  });
}
