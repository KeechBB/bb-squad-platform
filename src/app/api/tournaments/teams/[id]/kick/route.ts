import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canKickMember } from "@/lib/tournamentTeamPerms";
import { ACTIVE_TOURNAMENT } from "@/lib/tournaments";
import { personLabel, writeActionLog } from "@/lib/actionLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** POST — кикнуть игрока из команды (капитан / зам) */
export async function POST(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id: teamId } = await ctx.params;

  const me = await prisma.user.findUnique({
    where: { steamId: session.user.steamId },
    select: {
      id: true,
      nick: true,
      name: true,
      steamName: true,
      steamId: true,
    },
  });
  if (!me) return NextResponse.json({ error: "no user" }, { status: 401 });

  const actorMem = await prisma.tournamentTeamMember.findFirst({
    where: { teamId, userId: me.id },
  });
  if (!actorMem) {
    return NextResponse.json({ error: "Ты не в этой команде" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    targetUserId?: string;
  };
  const targetUserId = String(body.targetUserId || "").trim();
  if (!targetUserId) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const target = await prisma.tournamentTeamMember.findFirst({
    where: { teamId, userId: targetUserId },
    include: {
      user: {
        select: {
          id: true,
          nick: true,
          name: true,
          steamName: true,
          steamId: true,
        },
      },
    },
  });
  if (!target) {
    return NextResponse.json({ error: "Игрок не в команде" }, { status: 404 });
  }

  if (
    !canKickMember(
      { userId: me.id, role: actorMem.role },
      target.role,
      targetUserId
    )
  ) {
    return NextResponse.json(
      { error: "Нельзя кикнуть этого игрока" },
      { status: 403 }
    );
  }

  const teamRow = await prisma.tournamentTeam.findUnique({
    where: { id: teamId },
    select: { id: true, tag: true, name: true },
  });
  if (!teamRow) {
    return NextResponse.json({ error: "Команда не найдена" }, { status: 404 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.tournamentTeamMember.delete({ where: { id: target.id } });
    // Убрать из заявок этой команды на турниры
    const entries = await tx.tournamentEntry.findMany({
      where: { teamId },
      select: { id: true },
    });
    if (entries.length > 0) {
      await tx.tournamentEntryPlayer.deleteMany({
        where: {
          userId: targetUserId,
          entryId: { in: entries.map((e) => e.id) },
        },
      });
    }
  });

  const actorNick = personLabel(me);
  const targetNick = personLabel(target.user);
  await writeActionLog({
    category: "tournament",
    action: "team_kick",
    message: `${actorNick} кикнул ${targetNick} из [${teamRow.tag}]`,
    actorId: me.id,
    actorNick,
    targetId: targetUserId,
    targetNick,
    clanId: teamRow.id,
    clanTag: teamRow.tag,
    meta: {
      tournamentId: ACTIVE_TOURNAMENT.id,
      teamId,
      fromRole: target.role,
    },
  });

  return NextResponse.json({ ok: true });
}
