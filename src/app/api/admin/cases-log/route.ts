import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/requireAdmin";
import { BD_MARK } from "@/lib/blueberryDollar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Meta = {
  caseId?: string;
  caseName?: string;
  currency?: "BBC" | "BD";
  spent?: number;
  dropKind?: "patch" | "bg" | "empty" | "currency";
  dropItemId?: string | null;
  dropTitle?: string;
  dropImage?: string | null;
  dropSell?: number;
  dropSellCurrency?: "BBC" | "BD" | null;
  chancePct?: number;
  infiniteWallet?: boolean;
  boost?: boolean;
  boostKind?: string | null;
};

function asMeta(raw: unknown): Meta {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as Meta;
}

export async function GET(req: Request) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;

  const url = new URL(req.url);
  const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
  const caseId = String(url.searchParams.get("caseId") || "").trim();
  const drop = String(url.searchParams.get("drop") || "").trim(); // win | empty | ""
  const limitRaw = Number(url.searchParams.get("limit") || "300");
  const limit = Math.min(
    1000,
    Math.max(20, Number.isFinite(limitRaw) ? limitRaw : 300)
  );

  const rows = await prisma.actionLog.findMany({
    where: {
      category: "cases",
      action: "case_open",
      ...(q
        ? { searchText: { contains: q, mode: "insensitive" as const } }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(2000, limit * 3),
  });

  const entries = rows
    .map((r) => {
      const m = asMeta(r.meta);
      return {
        id: r.id,
        at: r.createdAt.toISOString(),
        nick: r.actorNick || "—",
        message: r.message,
        caseId: m.caseId || "",
        caseName: m.caseName || "—",
        currency: (m.currency === "BD" ? "BD" : "BBC") as "BBC" | "BD",
        spent: Number(m.spent) || 0,
        dropKind: (m.dropKind || "empty") as
          | "patch"
          | "bg"
          | "empty"
          | "currency",
        dropItemId: m.dropItemId || null,
        dropTitle: m.dropTitle || (m.dropKind === "empty" ? "Пусто" : "—"),
        dropImage: m.dropImage || null,
        dropSell: Number(m.dropSell) || 0,
        dropSellCurrency:
          m.dropSellCurrency === "BD" || m.dropSellCurrency === "BBC"
            ? m.dropSellCurrency
            : null,
        chancePct: Number(m.chancePct) || 0,
        infiniteWallet: Boolean(m.infiniteWallet),
        boost: Boolean(m.boost),
        boostKind: typeof m.boostKind === "string" ? m.boostKind : null,
        currencyMark: m.currency === "BD" ? BD_MARK : "BBC",
      };
    })
    .filter((e) => {
      if (caseId && e.caseId !== caseId) return false;
      if (drop === "win" && e.dropKind === "empty") return false;
      if (drop === "empty" && e.dropKind !== "empty") return false;
      return true;
    })
    .slice(0, limit);

  let spentBbc = 0;
  let spentBd = 0;
  let sellBbc = 0;
  let sellBd = 0;
  let wins = 0;
  let empties = 0;
  for (const e of entries) {
    if (e.currency === "BBC") spentBbc += e.spent;
    else spentBd += e.spent;
    if (e.dropKind === "empty") empties += 1;
    else {
      wins += 1;
      if (e.dropSellCurrency === "BBC") sellBbc += e.dropSell;
      else if (e.dropSellCurrency === "BD") sellBd += e.dropSell;
    }
  }

  return NextResponse.json({
    ok: true,
    entries,
    stats: {
      attempts: entries.length,
      wins,
      empties,
      spentBbc,
      spentBd,
      sellBbc,
      sellBd,
    },
  });
}
