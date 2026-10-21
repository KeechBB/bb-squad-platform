import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TOURNAMENT_TEAM_ROSTER_MAX } from "@/lib/tournaments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — мои входящие приглашения в турнирные команды */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const me = await prisma.user.findUnique({
    where: { steamId: session.user.steamId },
    select: { id: true },
  });
  if (!me) return NextResponse.json({ error: "no user" }, { status: 401 });

  const invites = await prisma.tournamentTeamInvite.findMany({
    where: { userId: me.id, status: "PENDING" },
    orderBy: { createdAt: "desc" },
    include: {
      team: { select: { id: true, name: true, tag: true, logoUrl: true } },
      inviter: { select: { nick: true } },
    },
  });

  return NextResponse.json({
    ok: true,
    invites: invites.map((i) => ({
      id: i.id,
      createdAt: i.createdAt.toISOString(),
      team: i.team,
      inviterNick: i.inviter.nick || "игрок",
    })),
    count: invites.length,
  });
}

/** POST — принять / отклонить */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const me = await prisma.user.findUnique({
    where: { steamId: session.user.steamId },
    select: { id: true },
  });
  if (!me) return NextResponse.json({ error: "no user" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    inviteId?: string;
    action?: string;
  };
  const inviteId = String(body.inviteId || "").trim();
  const action = String(body.action || "").trim();
  if (!inviteId || (action !== "accept" && action !== "decline")) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const invite = await prisma.tournamentTeamInvite.findFirst({
    where: { id: inviteId, userId: me.id, status: "PENDING" },
    include: { team: { include: { _count: { select: { members: true } } } } },
  });
  if (!invite) {
    return NextResponse.json({ error: "Приглашение не найдено" }, { status: 404 });
  }

  if (action === "decline") {
    await prisma.tournamentTeamInvite.update({
      where: { id: invite.id },
      data: { status: "DECLINED" },
    });
    return NextResponse.json({ ok: true, action: "decline" });
  }

  const already = await prisma.tournamentTeamMember.findFirst({
    where: { userId: me.id },
  });
  if (already) {
    return NextResponse.json(
      { error: "Ты уже в команде" },
      { status: 409 }
    );
  }
  if (invite.team._count.members >= TOURNAMENT_TEAM_ROSTER_MAX) {
    await prisma.tournamentTeamInvite.update({
      where: { id: invite.id },
      data: { status: "CANCELLED" },
    });
    return NextResponse.json({ error: "Состав уже полный" }, { status: 409 });
  }

  await prisma.$transaction([
    prisma.tournamentTeamInvite.update({
      where: { id: invite.id },
      data: { status: "ACCEPTED" },
    }),
    prisma.tournamentTeamMember.create({
      data: {
        teamId: invite.teamId,
        userId: me.id,
        role: "STARTER",
      },
    }),
  ]);

  return NextResponse.json({
    ok: true,
    action: "accept",
    teamId: invite.teamId,
    teamTag: invite.team.tag,
  });
}
