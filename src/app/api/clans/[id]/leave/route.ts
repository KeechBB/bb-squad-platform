import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
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

  if (membership.role === "LEADER") {
    const others = await prisma.clanMember.count({
      where: { clanId, NOT: { userId: me.id } },
    });
    if (others > 0) {
      return NextResponse.json(
        {
          error:
            "Глава не может выйти, пока в клане есть другие. Передай роль главы или распусти клан.",
        },
        { status: 403 }
      );
    }
    // последний участник — удаляем клан
    await prisma.clan.delete({ where: { id: clanId } });
    livePublish(clanLiveChannel(clanId), JSON.stringify({ type: "disband" }));
    livePublish(userLiveChannel(me.id), JSON.stringify({ type: "leave" }));
    return NextResponse.json({ ok: true, disbanded: true });
  }

  const squadIds = (
    await prisma.clanSquad.findMany({
      where: { clanId },
      select: { id: true },
    })
  ).map((s) => s.id);

  if (squadIds.length) {
    await prisma.clanSquadMember.deleteMany({
      where: { userId: me.id, squadId: { in: squadIds } },
    });
  }

  await prisma.clanMember.delete({ where: { id: membership.id } });

  livePublish(
    clanLiveChannel(clanId),
    JSON.stringify({ type: "leave", userId: me.id })
  );
  livePublish(userLiveChannel(me.id), JSON.stringify({ type: "leave" }));

  return NextResponse.json({ ok: true });
}
