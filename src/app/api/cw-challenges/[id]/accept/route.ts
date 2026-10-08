import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageCwChallenges, type ClanRole } from "@/lib/clan";
import { getUserClanMembership } from "@/lib/clanAccess";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Принять вызов — глава/зам другого клана. Пишет события в календари обоих. */
export async function POST(_req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const mine = await getUserClanMembership(session.user.steamId);
  if (!mine) {
    return NextResponse.json(
      { error: "Сначала вступите в клан" },
      { status: 403 }
    );
  }
  if (!canManageCwChallenges(mine.membership.role as ClanRole)) {
    return NextResponse.json(
      { error: "Принимать вызов могут только глава или зам" },
      { status: 403 }
    );
  }
  if (mine.membership.clan.isExternal) {
    return NextResponse.json(
      { error: "Внешний клан не может принимать заявки" },
      { status: 403 }
    );
  }

  const challenge = await prisma.cwChallenge.findUnique({
    where: { id },
    include: {
      challengerClan: { select: { id: true, tag: true, name: true } },
    },
  });
  if (!challenge || challenge.status !== "OPEN") {
    return NextResponse.json(
      { error: "Заявка не найдена или уже закрыта" },
      { status: 404 }
    );
  }
  if (challenge.challengerClanId === mine.membership.clanId) {
    return NextResponse.json(
      { error: "Нельзя принять свой же вызов" },
      { status: 400 }
    );
  }

  const acceptor = mine.membership.clan;

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.cwChallenge.update({
      where: { id },
      data: {
        status: "ACCEPTED",
        acceptorClanId: acceptor.id,
        acceptedById: mine.userId,
      },
    });

    await tx.clanCalendarEvent.createMany({
      data: [
        {
          clanId: challenge.challengerClanId,
          challengeId: challenge.id,
          mode: challenge.mode,
          format: challenge.format,
          scheduledAt: challenge.scheduledAt,
          opponentTag: acceptor.tag,
          opponentName: acceptor.name,
          status: "upcoming",
        },
        {
          clanId: acceptor.id,
          challengeId: challenge.id,
          mode: challenge.mode,
          format: challenge.format,
          scheduledAt: challenge.scheduledAt,
          opponentTag: challenge.challengerClan.tag,
          opponentName: challenge.challengerClan.name,
          status: "upcoming",
        },
      ],
    });

    return updated;
  });

  return NextResponse.json({ ok: true, challengeId: result.id });
}
