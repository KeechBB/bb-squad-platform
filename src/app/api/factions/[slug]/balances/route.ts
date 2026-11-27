import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { loadFactionView } from "@/lib/factions";
import {
  BALANCES_DAY_MIN_YMD,
  factionBalanceDays,
  listBalanceFactions,
  listBalancePlayers,
  playerPersonalDays,
} from "@/lib/factionBalances";
import { getSelfListStatus } from "@/lib/factionAuction";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const session = await getServerSession(authOptions);
  const loaded = await loadFactionView(
    decodeURIComponent(slug),
    session?.user?.steamId ?? null,
  );
  if (loaded.error || !loaded.view) {
    return NextResponse.json({ error: "notfound" }, { status: 404 });
  }
  if (!loaded.view.keech && !loaded.view.mySeat) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const factionId = String(url.searchParams.get("factionId") || "").trim();
  const userId = String(url.searchParams.get("userId") || "").trim();

  if (factionId) {
    const f = await prisma.faction.findUnique({
      where: { id: factionId },
      select: { id: true, name: true, slug: true, logoUrl: true, blueberryBalance: true },
    });
    if (!f) return NextResponse.json({ error: "notfound" }, { status: 404 });
    const days = await factionBalanceDays(factionId);
    return NextResponse.json({
      minYmd: BALANCES_DAY_MIN_YMD,
      faction: {
        id: f.id,
        name: f.name,
        slug: f.slug,
        logoUrl: f.logoUrl,
        balance: Math.max(0, f.blueberryBalance || 0),
      },
      days,
    });
  }

  if (userId) {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        nick: true,
        steamName: true,
        blueberryBalance: true,
        factionMembership: {
          select: {
            seat: true,
            faction: { select: { id: true, name: true, slug: true, logoUrl: true } },
          },
        },
      },
    });
    if (!u) return NextResponse.json({ error: "notfound" }, { status: 404 });
    const days = await playerPersonalDays(userId);
    const mem = u.factionMembership;
    return NextResponse.json({
      minYmd: BALANCES_DAY_MIN_YMD,
      player: {
        userId: u.id,
        nick: u.nick || u.steamName || "игрок",
        balance: Math.max(0, u.blueberryBalance || 0),
        seat: mem?.seat || null,
        faction: mem?.faction || null,
      },
      days,
    });
  }

  const [factions, players, selfList] = await Promise.all([
    listBalanceFactions(),
    listBalancePlayers(),
    getSelfListStatus(loaded.me?.id ?? null),
  ]);

  return NextResponse.json({
    minYmd: BALANCES_DAY_MIN_YMD,
    factions,
    players,
    selfList,
    totals: {
      factionTreasury: factions.reduce((s, f) => s + f.balance, 0),
      playerPersonal: players.reduce((s, p) => s + p.balance, 0),
    },
  });
}
