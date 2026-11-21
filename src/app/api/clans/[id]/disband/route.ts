import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canDeleteClan } from "@/lib/clan";
import { resolveClanActor } from "@/lib/clanActor";
import { clanLiveChannel, livePublish, userLiveChannel } from "@/lib/liveBus";
import { personLabel, writeActionLog } from "@/lib/actionLog";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }

  const { id: clanId } = await ctx.params;
  const actor = await resolveClanActor(clanId, session.user.steamId);
  if (!actor) {
    return NextResponse.json({ error: "Ты не в этом клане" }, { status: 404 });
  }
  if (!canDeleteClan(actor.member.role)) {
    return NextResponse.json(
      { error: "Только глава может удалить клан" },
      { status: 403 }
    );
  }
  const me = actor.user;

  const clan = await prisma.clan.findUnique({
    where: { id: clanId },
    select: { tag: true, name: true },
  });
  const memberUserIds = (
    await prisma.clanMember.findMany({
      where: { clanId },
      select: { userId: true },
    })
  ).map((m) => m.userId);

  await prisma.clan.delete({ where: { id: clanId } });

  const meNick = personLabel(me);
  await writeActionLog({
    category: "clan",
    action: "disband",
    message: `${meNick} распустил клан [${clan?.tag || "?"}] ${clan?.name || ""}`.trim(),
    actorId: me.id,
    actorNick: meNick,
    clanId,
    clanTag: clan?.tag,
  });

  livePublish(clanLiveChannel(clanId), JSON.stringify({ type: "disband" }));
  for (const uid of memberUserIds) {
    livePublish(userLiveChannel(uid), JSON.stringify({ type: "disband" }));
  }

  return NextResponse.json({ ok: true });
}
