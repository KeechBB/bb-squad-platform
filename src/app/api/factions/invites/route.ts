import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isBuiltinSuperAdmin } from "@/lib/admin";
import { personLabel } from "@/lib/actionLog";
import { actorNick, logFaction } from "@/lib/factions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function meFromSession() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) return null;
  const me = await prisma.user.findUnique({
    where: { steamId: session.user.steamId },
    select: { id: true, nick: true, name: true, steamName: true, steamId: true },
  });
  return me;
}

/** Входящие приглашения во фракции. */
export async function GET() {
  const me = await meFromSession();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const invites = await prisma.factionInvite.findMany({
    where: { userId: me.id, status: "PENDING" },
    orderBy: { createdAt: "desc" },
    include: {
      faction: { select: { id: true, name: true, slug: true } },
      inviter: { select: { nick: true, steamName: true } },
    },
  });

  return NextResponse.json({
    invites: invites.map((i) => ({
      id: i.id,
      factionName: i.faction.name,
      inviterNick: i.inviter.nick || i.inviter.steamName || "игрок",
    })),
  });
}

/** Принять или отклонить приглашение. */
export async function POST(req: Request) {
  const me = await meFromSession();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (isBuiltinSuperAdmin(me.steamId)) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { inviteId?: string; action?: string };
  const inviteId = String(body.inviteId || "").trim();
  const action = String(body.action || "").trim();
  if (!inviteId || (action !== "accept" && action !== "decline")) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const invite = await prisma.factionInvite.findFirst({
    where: { id: inviteId, userId: me.id, status: "PENDING" },
    include: { faction: { select: { id: true, name: true, clanId: true } } },
  });
  if (!invite) {
    return NextResponse.json({ error: "Приглашение не найдено" }, { status: 404 });
  }

  if (action === "decline") {
    await prisma.factionInvite.update({
      where: { id: invite.id },
      data: { status: "DECLINED" },
    });
    return NextResponse.json({ ok: true, action: "decline" });
  }

  const inClan = await prisma.clanMember.findUnique({
    where: { clanId_userId: { clanId: invite.faction.clanId, userId: me.id } },
  });
  if (!inClan) {
    await prisma.factionInvite.update({
      where: { id: invite.id },
      data: { status: "CANCELLED" },
    });
    return NextResponse.json({ error: "Ты уже не в клане BlackBerry" }, { status: 409 });
  }

  const elsewhere = await prisma.factionMember.findUnique({ where: { userId: me.id } });
  if (elsewhere) {
    await prisma.factionInvite.update({
      where: { id: invite.id },
      data: { status: "CANCELLED" },
    });
    return NextResponse.json({ error: "Ты уже во фракции" }, { status: 409 });
  }

  await prisma.$transaction([
    prisma.factionMember.create({
      data: { factionId: invite.factionId, userId: me.id, seat: "MEMBER" },
    }),
    prisma.factionInvite.update({
      where: { id: invite.id },
      data: { status: "ACCEPTED" },
    }),
    prisma.factionInvite.updateMany({
      where: { userId: me.id, status: "PENDING", id: { not: invite.id } },
      data: { status: "CANCELLED" },
    }),
  ]);

  await logFaction("join", {
    actorId: me.id,
    actorNick: actorNick(me, false),
    targetId: me.id,
    targetNick: personLabel(me),
    factionName: invite.faction.name,
    clanId: invite.faction.clanId,
    how: "принял приглашение",
  });

  return NextResponse.json({ ok: true, action: "accept" });
}
