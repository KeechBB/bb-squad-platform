import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { loadFactionView } from "@/lib/factions";
import { factionWeekBoard } from "@/lib/factionBoard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  const { slug } = await ctx.params;
  const loaded = await loadFactionView(decodeURIComponent(slug), session?.user?.steamId ?? null);
  if (loaded.error || !loaded.view) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 404 });
  }
  const kind = new URL(req.url).searchParams.get("kind");
  if (kind !== "cw" && kind !== "train") {
    return NextResponse.json({ error: "Неизвестная вкладка" }, { status: 400 });
  }
  const board = await factionWeekBoard(loaded.view.clanId, kind);
  return NextResponse.json(board);
}
