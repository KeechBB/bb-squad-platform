import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageCwChallenges, type ClanRole } from "@/lib/clan";
import { getUserClanMembership } from "@/lib/clanAccess";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Отменить свою открытую заявку — глава/зам клана-заявителя. */
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
      { error: "Отменять заявку могут только глава или зам" },
      { status: 403 }
    );
  }

  const challenge = await prisma.cwChallenge.findUnique({ where: { id } });
  if (!challenge || challenge.status !== "OPEN") {
    return NextResponse.json(
      { error: "Заявка не найдена или уже закрыта" },
      { status: 404 }
    );
  }
  if (challenge.challengerClanId !== mine.membership.clanId) {
    return NextResponse.json(
      { error: "Можно отменить только заявку своего клана" },
      { status: 403 }
    );
  }

  await prisma.cwChallenge.update({
    where: { id },
    data: { status: "CANCELLED" },
  });

  return NextResponse.json({ ok: true, challengeId: id });
}
