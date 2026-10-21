import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TOURNAMENT_TEAM_ROSTER_MAX } from "@/lib/tournaments";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST — пригласить в команду по нику или Steam ID */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const me = await prisma.user.findUnique({
    where: { steamId: session.user.steamId },
    select: { id: true, nick: true },
  });
  if (!me) return NextResponse.json({ error: "no user" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    teamId?: string;
    q?: string;
    nick?: string;
    steamId?: string;
  };
  const teamId = String(body.teamId || "").trim();
  const q = String(body.q || body.nick || body.steamId || "").trim();
  if (!teamId || q.length < 2) {
    return NextResponse.json({ error: "Нужны teamId и ник/Steam" }, { status: 400 });
  }

  const membership = await prisma.tournamentTeamMember.findFirst({
    where: {
      teamId,
      userId: me.id,
      role: { in: ["CAPTAIN", "DEPUTY"] },
    },
  });
  if (!membership) {
    return NextResponse.json(
      { error: "Приглашать могут капитан и зам" },
      { status: 403 }
    );
  }

  const team = await prisma.tournamentTeam.findUnique({
    where: { id: teamId },
    include: { _count: { select: { members: true } } },
  });
  if (!team) {
    return NextResponse.json({ error: "Команда не найдена" }, { status: 404 });
  }
  if (team._count.members >= TOURNAMENT_TEAM_ROSTER_MAX) {
    return NextResponse.json({ error: "Состав полный" }, { status: 409 });
  }

  const digitsOnly = /^\d+$/.test(q);
  const where: Prisma.UserWhereInput = {
    profileComplete: true,
    OR: digitsOnly
      ? [{ steamId: q }, { nick: { equals: q, mode: "insensitive" } }]
      : [
          { nick: { equals: q, mode: "insensitive" } },
          { steamId: q },
        ],
  };
  let target = await prisma.user.findFirst({ where, select: { id: true, nick: true, steamId: true } });
  if (!target && !digitsOnly) {
    target = await prisma.user.findFirst({
      where: {
        profileComplete: true,
        OR: [
          { nick: { contains: q, mode: "insensitive" } },
          { steamId: { contains: q } },
        ],
      },
      select: { id: true, nick: true, steamId: true },
    });
  }
  if (!target) {
    return NextResponse.json({ error: "Игрок не найден" }, { status: 404 });
  }
  if (target.id === me.id) {
    return NextResponse.json({ error: "Нельзя пригласить себя" }, { status: 400 });
  }

  const alreadyMember = await prisma.tournamentTeamMember.findFirst({
    where: { userId: target.id },
  });
  if (alreadyMember) {
    return NextResponse.json(
      { error: "Игрок уже в другой команде" },
      { status: 409 }
    );
  }

  const pending = await prisma.tournamentTeamInvite.findFirst({
    where: { teamId, userId: target.id, status: "PENDING" },
  });
  if (pending) {
    return NextResponse.json({ error: "Приглашение уже отправлено" }, { status: 409 });
  }

  const invite = await prisma.tournamentTeamInvite.create({
    data: {
      teamId,
      userId: target.id,
      invitedBy: me.id,
      status: "PENDING",
    },
  });

  return NextResponse.json({
    ok: true,
    invite: {
      id: invite.id,
      nick: target.nick || target.steamId,
      sentAt: invite.createdAt.toISOString(),
    },
  });
}
