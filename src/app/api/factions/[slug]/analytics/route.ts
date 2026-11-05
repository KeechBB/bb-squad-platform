import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadFactionView } from "@/lib/factions";
import { clanFactionPicks, factionRoleDonut } from "@/lib/factionBoard";

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
  const asked = new URL(req.url).searchParams.get("faction") || loaded.view.slug;
  let factionId = loaded.view.id;
  if (asked !== loaded.view.slug) {
    const other = await prisma.faction.findFirst({
      where: { slug: asked, clanId: loaded.view.clanId },
      select: { id: true },
    });
    if (!other) return NextResponse.json({ error: "Фракция не найдена" }, { status: 404 });
    factionId = other.id;
  }
  const [board, factions] = await Promise.all([
    factionRoleDonut(factionId),
    clanFactionPicks(loaded.view.clanId),
  ]);
  return NextResponse.json({ ...board, factions, active: asked });
}
