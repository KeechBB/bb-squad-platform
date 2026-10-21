import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { TournamentTeamRole } from "@prisma/client";
import { allowedTargetRoles } from "@/lib/tournamentTeamPerms";
import { ACTIVE_TOURNAMENT } from "@/lib/tournaments";
import { personLabel, writeActionLog } from "@/lib/actionLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const ALL: TournamentTeamRole[] = [
  "CAPTAIN",
  "DEPUTY",
  "STARTER",
  "SUB",
  "RESERVE",
];

const ROLE_RU: Record<TournamentTeamRole, string> = {
  CAPTAIN: "капитан",
  DEPUTY: "зам",
  STARTER: "основа",
  SUB: "замена",
  RESERVE: "резерв",
};

/** POST — выдать роль игроку */
export async function POST(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id: teamId } = await ctx.params;

  const me = await prisma.user.findUnique({
    where: { steamId: session.user.steamId },
    select: { id: true, nick: true, name: true, steamName: true, steamId: true },
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
    role?: string;
  };
  const targetUserId = String(body.targetUserId || "").trim();
  const role = String(body.role || "").trim().toUpperCase() as TournamentTeamRole;
  if (!targetUserId || !ALL.includes(role)) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const target = await prisma.tournamentTeamMember.findFirst({
    where: { teamId, userId: targetUserId },
  });
  if (!target) {
    return NextResponse.json({ error: "Игрок не в команде" }, { status: 404 });
  }

  const allowed = allowedTargetRoles(
    { userId: me.id, role: actorMem.role },
    target.role,
    targetUserId
  );
  if (!allowed || !allowed.includes(role)) {
    return NextResponse.json(
      { error: "Нельзя выдать эту роль этому игроку" },
      { status: 403 }
    );
  }

  if (target.role === role) {
    return NextResponse.json({ ok: true, role });
  }

  // Капитан не снимает себя сам — только передача другому
  if (
    actorMem.role === "CAPTAIN" &&
    target.userId === me.id &&
    target.role === "CAPTAIN" &&
    role !== "CAPTAIN"
  ) {
    return NextResponse.json(
      { error: "Передай капитанство другому игроку" },
      { status: 400 }
    );
  }

  const [teamRow, targetUser] = await Promise.all([
    prisma.tournamentTeam.findUnique({
      where: { id: teamId },
      select: { id: true, tag: true, name: true },
    }),
    prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, nick: true, name: true, steamName: true, steamId: true },
    }),
  ]);
  if (!teamRow) {
    return NextResponse.json({ error: "Команда не найдена" }, { status: 404 });
  }

  const prevRole = target.role;

  await prisma.$transaction(async (tx) => {
    if (role === "CAPTAIN") {
      // Передача капитанства: старый капитан → STARTER
      await tx.tournamentTeamMember.updateMany({
        where: { teamId, role: "CAPTAIN" },
        data: { role: "STARTER" },
      });
    }
    if (role === "DEPUTY") {
      await tx.tournamentTeamMember.updateMany({
        where: { teamId, role: "DEPUTY", NOT: { userId: targetUserId } },
        data: { role: "STARTER" },
      });
    }
    await tx.tournamentTeamMember.update({
      where: { id: target.id },
      data: { role },
    });
  });

  const actorNick = personLabel(me);
  const targetNick = targetUser ? personLabel(targetUser) : targetUserId;
  const roleMsg =
    role === "CAPTAIN"
      ? `${actorNick} передал капитанство ${targetNick} в [${teamRow.tag}]`
      : `${actorNick} сменил роль ${targetNick}: ${ROLE_RU[prevRole]} → ${ROLE_RU[role]} в [${teamRow.tag}]`;
  await writeActionLog({
    category: "tournament",
    action: "role_set",
    message: roleMsg,
    actorId: me.id,
    actorNick,
    targetId: targetUserId,
    targetNick,
    clanId: teamRow.id,
    clanTag: teamRow.tag,
    meta: {
      tournamentId: ACTIVE_TOURNAMENT.id,
      teamId,
      from: prevRole,
      to: role,
    },
  });

  return NextResponse.json({ ok: true, role });
}
