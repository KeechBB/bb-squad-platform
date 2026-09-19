import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  canAssignClanRole,
  canKickClanMember,
  canManageClanMembers,
  type ClanRole,
} from "@/lib/clan";
import { clanLiveChannel, livePublish, userLiveChannel } from "@/lib/liveBus";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

async function actorMembership(clanId: string, steamId: string) {
  const user = await prisma.user.findUnique({ where: { steamId } });
  if (!user) return null;
  const member = await prisma.clanMember.findUnique({
    where: { clanId_userId: { clanId, userId: user.id } },
  });
  if (!member) return null;
  return { user, member };
}

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const clan = await prisma.clan.findUnique({
    where: { id },
    include: {
      members: {
        include: {
          user: {
            select: {
              id: true,
              nick: true,
              name: true,
              avatarUrl: true,
              steamName: true,
              reserveUntil: true,
              reserveReason: true,
            },
          },
        },
        orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
      },
      leader: { select: { nick: true } },
    },
  });
  if (!clan) {
    return NextResponse.json({ error: "Клан не найден" }, { status: 404 });
  }
  return NextResponse.json({ clan });
}

export async function POST(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }
  const { id: clanId } = await ctx.params;
  const actor = await actorMembership(clanId, session.user.steamId);
  if (!actor || !canManageClanMembers(actor.member.role)) {
    return NextResponse.json({ error: "Нет прав приглашать" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const nickOrId = String((body as { user?: string })?.user || "").trim();
  if (!nickOrId) {
    return NextResponse.json({ error: "Укажи ник или id" }, { status: 400 });
  }

  const target = await prisma.user.findFirst({
    where: {
      OR: [{ id: nickOrId }, { nick: { equals: nickOrId, mode: "insensitive" } }],
      profileComplete: true,
    },
  });
  if (!target) {
    return NextResponse.json({ error: "Игрок не найден" }, { status: 404 });
  }

  const already = await prisma.clanMember.findUnique({
    where: { clanId_userId: { clanId, userId: target.id } },
  });
  if (already) {
    return NextResponse.json({ error: "Уже в клане" }, { status: 409 });
  }

  const pending = await prisma.clanInvite.findFirst({
    where: { clanId, userId: target.id, status: "PENDING" },
  });
  if (pending) {
    return NextResponse.json({ error: "Приглашение уже отправлено" }, { status: 409 });
  }

  const invite = await prisma.clanInvite.create({
    data: {
      clanId,
      userId: target.id,
      invitedBy: actor.user.id,
      status: "PENDING",
    },
  });

  livePublish(clanLiveChannel(clanId), JSON.stringify({ type: "invite" }));
  livePublish(userLiveChannel(target.id), JSON.stringify({ type: "invite" }));

  return NextResponse.json({ ok: true, invite });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }
  const { id: clanId } = await ctx.params;
  const actor = await actorMembership(clanId, session.user.steamId);
  if (!actor || !canManageClanMembers(actor.member.role)) {
    return NextResponse.json({ error: "Нет прав" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const memberId = String((body as { memberId?: string })?.memberId || "");
  const role = String((body as { role?: string })?.role || "") as ClanRole;

  if (!memberId || !role) {
    return NextResponse.json({ error: "Нужны memberId и role" }, { status: 400 });
  }

  const target = await prisma.clanMember.findFirst({
    where: { id: memberId, clanId },
  });
  if (!target) {
    return NextResponse.json({ error: "Участник не найден" }, { status: 404 });
  }
  if (target.userId === actor.user.id) {
    return NextResponse.json({ error: "Нельзя менять свою роль" }, { status: 403 });
  }
  if (!canAssignClanRole(actor.member.role, role)) {
    return NextResponse.json({ error: "Нельзя выдать эту роль" }, { status: 403 });
  }
  if (target.role === "LEADER") {
    return NextResponse.json({ error: "Главу сменить нельзя" }, { status: 403 });
  }
  if (actor.member.role === "DEPUTY") {
    if (target.role === "DEPUTY" || !canAssignClanRole("DEPUTY", target.role as ClanRole)) {
      return NextResponse.json({ error: "Заместитель не может менять эту роль" }, { status: 403 });
    }
  }

  const updated = await prisma.clanMember.update({
    where: { id: memberId },
    data: { role },
  });
  livePublish(
    clanLiveChannel(clanId),
    JSON.stringify({ type: "role", memberId, role })
  );
  livePublish(
    userLiveChannel(target.userId),
    JSON.stringify({ type: "role", role })
  );
  return NextResponse.json({ ok: true, member: updated });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }
  const { id: clanId } = await ctx.params;
  const actor = await actorMembership(clanId, session.user.steamId);
  if (!actor || !canManageClanMembers(actor.member.role)) {
    return NextResponse.json({ error: "Нет прав кикать" }, { status: 403 });
  }

  const url = new URL(req.url);
  const memberId = url.searchParams.get("memberId") || "";
  const target = await prisma.clanMember.findFirst({
    where: { id: memberId, clanId },
  });
  if (!target) {
    return NextResponse.json({ error: "Участник не найден" }, { status: 404 });
  }
  if (!canKickClanMember(actor.member.role, target.role)) {
    return NextResponse.json({ error: "Нельзя кикнуть этого игрока" }, { status: 403 });
  }

  await prisma.clanMember.delete({ where: { id: memberId } });
  livePublish(clanLiveChannel(clanId), JSON.stringify({ type: "kick", memberId }));
  livePublish(userLiveChannel(target.userId), JSON.stringify({ type: "kick" }));
  return NextResponse.json({ ok: true });
}
