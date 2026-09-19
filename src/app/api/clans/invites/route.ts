import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { clanLiveChannel, livePublish, userLiveChannel } from "@/lib/liveBus";

export const runtime = "nodejs";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }
  const me = await prisma.user.findUnique({
    where: { steamId: session.user.steamId },
  });
  if (!me) {
    return NextResponse.json({ invites: [] });
  }

  const invites = await prisma.clanInvite.findMany({
    where: { userId: me.id, status: "PENDING" },
    include: {
      clan: { select: { id: true, name: true, tag: true, logoUrl: true } },
      inviter: { select: { nick: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ invites });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }
  const me = await prisma.user.findUnique({
    where: { steamId: session.user.steamId },
  });
  if (!me) {
    return NextResponse.json({ error: "Не найден" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const inviteId = String((body as { inviteId?: string })?.inviteId || "");
  const action = String((body as { action?: string })?.action || "");
  if (!inviteId || (action !== "accept" && action !== "decline")) {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }

  const invite = await prisma.clanInvite.findFirst({
    where: { id: inviteId, userId: me.id, status: "PENDING" },
  });
  if (!invite) {
    return NextResponse.json({ error: "Приглашение не найдено" }, { status: 404 });
  }

  if (action === "decline") {
    await prisma.clanInvite.update({
      where: { id: inviteId },
      data: { status: "DECLINED" },
    });
    livePublish(userLiveChannel(me.id), JSON.stringify({ type: "invite" }));
    return NextResponse.json({ ok: true });
  }

  const inClan = await prisma.clanMember.findFirst({
    where: { userId: me.id },
    include: { clan: { select: { tag: true, name: true } } },
  });
  if (inClan) {
    return NextResponse.json(
      {
        error: `Сначала выйди из [${inClan.clan.tag}] ${inClan.clan.name}`,
      },
      { status: 409 }
    );
  }

  const already = await prisma.clanMember.findUnique({
    where: {
      clanId_userId: { clanId: invite.clanId, userId: me.id },
    },
  });
  if (!already) {
    await prisma.clanMember.create({
      data: {
        clanId: invite.clanId,
        userId: me.id,
        role: "MEMBER",
      },
    });
  }
  await prisma.clanInvite.update({
    where: { id: inviteId },
    data: { status: "ACCEPTED" },
  });

  livePublish(clanLiveChannel(invite.clanId), JSON.stringify({ type: "join" }));
  livePublish(userLiveChannel(me.id), JSON.stringify({ type: "join" }));

  return NextResponse.json({ ok: true, clanId: invite.clanId });
}
