import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canDeleteClan, type ClanRole } from "@/lib/clan";
import { clanLiveChannel, livePublish, userLiveChannel } from "@/lib/liveBus";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }

  const { id: clanId } = await ctx.params;
  const me = await prisma.user.findUnique({
    where: { steamId: session.user.steamId },
  });
  if (!me) {
    return NextResponse.json({ error: "Не найден" }, { status: 404 });
  }

  const membership = await prisma.clanMember.findUnique({
    where: { clanId_userId: { clanId, userId: me.id } },
  });
  if (!membership) {
    return NextResponse.json({ error: "Ты не в этом клане" }, { status: 404 });
  }
  if (!canDeleteClan(membership.role as ClanRole)) {
    return NextResponse.json(
      { error: "Только глава может удалить клан" },
      { status: 403 }
    );
  }

  const memberUserIds = (
    await prisma.clanMember.findMany({
      where: { clanId },
      select: { userId: true },
    })
  ).map((m) => m.userId);

  await prisma.clan.delete({ where: { id: clanId } });

  livePublish(clanLiveChannel(clanId), JSON.stringify({ type: "disband" }));
  for (const uid of memberUserIds) {
    livePublish(userLiveChannel(uid), JSON.stringify({ type: "disband" }));
  }

  return NextResponse.json({ ok: true });
}
