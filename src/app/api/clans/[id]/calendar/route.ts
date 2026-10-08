import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { modeLabel } from "@/lib/cwChallenge";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }

  const { id: clanId } = await ctx.params;
  const clan = await prisma.clan.findUnique({
    where: { id: clanId },
    select: { id: true, tag: true, name: true },
  });
  if (!clan) {
    return NextResponse.json({ error: "Клан не найден" }, { status: 404 });
  }

  const events = await prisma.clanCalendarEvent.findMany({
    where: { clanId },
    orderBy: { scheduledAt: "asc" },
    take: 200,
  });

  return NextResponse.json({
    ok: true,
    clan,
    events: events.map((e) => ({
      id: e.id,
      mode: e.mode,
      modeLabel: modeLabel(e.mode),
      format: e.format,
      scheduledAt: e.scheduledAt.toISOString(),
      opponentTag: e.opponentTag,
      opponentName: e.opponentName,
      assignedServer: e.assignedServer,
      status: e.status,
      challengeId: e.challengeId,
    })),
  });
}
