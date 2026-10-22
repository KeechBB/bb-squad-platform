import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type VoteCounts = {
  likes: number;
  dislikes: number;
  myVote: 1 | -1 | null;
};

async function countsFor(
  teamId: string,
  userId: string | null
): Promise<VoteCounts> {
  const [likes, dislikes, mine] = await Promise.all([
    prisma.tournamentTeamVote.count({ where: { teamId, value: 1 } }),
    prisma.tournamentTeamVote.count({ where: { teamId, value: -1 } }),
    userId
      ? prisma.tournamentTeamVote.findUnique({
          where: { teamId_userId: { teamId, userId } },
          select: { value: true },
        })
      : null,
  ]);
  const v = mine?.value;
  return {
    likes,
    dislikes,
    myVote: v === 1 || v === -1 ? v : null,
  };
}

/** POST — поставить / сменить / снять голос (value: 1 | -1; повтор того же — снять) */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id: teamId } = await ctx.params;
  if (!teamId) {
    return NextResponse.json({ error: "no team" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as { value?: unknown };
  const raw = Number(body.value);
  if (raw !== 1 && raw !== -1) {
    return NextResponse.json(
      { error: "value: 1 или -1" },
      { status: 400 }
    );
  }
  const value = raw as 1 | -1;

  const me = await prisma.user.findUnique({
    where: { steamId: session.user.steamId },
    select: { id: true },
  });
  if (!me) return NextResponse.json({ error: "no user" }, { status: 401 });

  const team = await prisma.tournamentTeam.findUnique({
    where: { id: teamId },
    select: { id: true },
  });
  if (!team) {
    return NextResponse.json({ error: "Команда не найдена" }, { status: 404 });
  }

  const existing = await prisma.tournamentTeamVote.findUnique({
    where: { teamId_userId: { teamId, userId: me.id } },
    select: { id: true, value: true },
  });

  if (existing && existing.value === value) {
    await prisma.tournamentTeamVote.delete({ where: { id: existing.id } });
  } else if (existing) {
    await prisma.tournamentTeamVote.update({
      where: { id: existing.id },
      data: { value },
    });
  } else {
    await prisma.tournamentTeamVote.create({
      data: { teamId, userId: me.id, value },
    });
  }

  const votes = await countsFor(teamId, me.id);
  return NextResponse.json({ ok: true, ...votes });
}
