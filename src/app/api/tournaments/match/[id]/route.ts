import { NextResponse } from "next/server";
import { loadFruitStrikeLive } from "@/lib/fruitStrikeLive";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const live = await loadFruitStrikeLive();
  const row = live?.matches?.[id];
  if (!row) {
    return NextResponse.json({ error: "Нет статистики матча" }, { status: 404 });
  }
  const sheet = (row.sheet || {}) as Record<string, unknown>;
  const sides = ["r1", "r2", "oppR1", "oppR2"] as const;
  const hasPlayers = sides.some(
    (key) => Array.isArray(sheet[key]) && (sheet[key] as unknown[]).length > 0
  );
  return NextResponse.json(
    {
      r1: sheet.r1 || [],
      r2: sheet.r2 || [],
      oppR1: sheet.oppR1 || [],
      oppR2: sheet.oppR2 || [],
      total: sheet.total || [],
      oppTotal: sheet.oppTotal || [],
      details: sheet.details || null,
      mvp: sheet.mvp || null,
      clan: row.teamA?.tag || "",
      opp: row.teamB?.tag || "",
      note: hasPlayers
        ? ""
        : "Листа игроков по этой катке нет. Счёт встречи в шапке.",
    },
    {
      headers: { "Cache-Control": "no-store" },
    }
  );
}
