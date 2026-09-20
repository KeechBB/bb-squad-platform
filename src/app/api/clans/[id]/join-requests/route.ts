import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { ClanRole } from "@/lib/clan";
import { canReviewClanJoinRequests } from "@/lib/titles";
import { clanLiveChannel, livePublish, userLiveChannel } from "@/lib/liveBus";
import { personLabel, writeActionLog } from "@/lib/actionLog";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

async function actorInClan(clanId: string, steamId: string) {
  const user = await prisma.user.findUnique({ where: { steamId } });
  if (!user) return null;
  const member = await prisma.clanMember.findUnique({
    where: { clanId_userId: { clanId, userId: user.id } },
    include: { title: { select: { name: true } } },
  });
  if (!member) return { user, member: null };
  return { user, member };
}

export async function GET(_req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  const { id: clanId } = await ctx.params;

  if (!session?.user?.steamId) {
    return NextResponse.json({ requests: [], myRequest: null });
  }

  const actor = await actorInClan(clanId, session.user.steamId);
  if (!actor) {
    return NextResponse.json({ requests: [], myRequest: null });
  }

  const myRequest = await prisma.clanJoinRequest.findFirst({
    where: { clanId, userId: actor.user.id, status: "PENDING" },
    select: { id: true, status: true, createdAt: true },
  });

  const canReview =
    actor.member != null &&
    canReviewClanJoinRequests(
      actor.member.role as ClanRole,
      actor.member.title?.name
    );

  if (!canReview) {
    return NextResponse.json({ requests: [], myRequest });
  }

  const requests = await prisma.clanJoinRequest.findMany({
    where: { clanId, status: "PENDING" },
    orderBy: { createdAt: "asc" },
    include: {
      user: {
        select: {
          id: true,
          nick: true,
          name: true,
          avatarUrl: true,
          steamName: true,
        },
      },
    },
  });

  return NextResponse.json({ requests, myRequest });
}

export async function POST(_req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }
  if (!session.user.profileComplete) {
    return NextResponse.json(
      { error: "Сначала заверши профиль" },
      { status: 403 }
    );
  }

  const { id: clanId } = await ctx.params;
  const clan = await prisma.clan.findUnique({ where: { id: clanId } });
  if (!clan) {
    return NextResponse.json({ error: "Клан не найден" }, { status: 404 });
  }

  const me = await prisma.user.findUnique({
    where: { steamId: session.user.steamId },
  });
  if (!me) {
    return NextResponse.json({ error: "Не найден" }, { status: 404 });
  }

  const alreadyHere = await prisma.clanMember.findUnique({
    where: { clanId_userId: { clanId, userId: me.id } },
  });
  if (alreadyHere) {
    return NextResponse.json({ error: "Ты уже в этом клане" }, { status: 409 });
  }

  const otherClan = await prisma.clanMember.findFirst({
    where: { userId: me.id },
    include: { clan: { select: { tag: true, name: true } } },
  });
  if (otherClan) {
    return NextResponse.json(
      {
        error: `Сначала выйди из [${otherClan.clan.tag}] ${otherClan.clan.name}`,
      },
      { status: 409 }
    );
  }

  const pending = await prisma.clanJoinRequest.findFirst({
    where: { clanId, userId: me.id, status: "PENDING" },
  });
  if (pending) {
    return NextResponse.json(
      { error: "Заявка уже отправлена", request: pending },
      { status: 409 }
    );
  }

  const request = await prisma.clanJoinRequest.create({
    data: { clanId, userId: me.id, status: "PENDING" },
  });

  await writeActionLog({
    category: "clan",
    action: "join_request",
    message: `${personLabel(me)} подал заявку в [${clan.tag}] ${clan.name}`,
    actorId: me.id,
    actorNick: personLabel(me),
    clanId,
    clanTag: clan.tag,
  });

  livePublish(clanLiveChannel(clanId), JSON.stringify({ type: "join-request" }));
  return NextResponse.json({ ok: true, request });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }

  const { id: clanId } = await ctx.params;
  const body = await req.json().catch(() => null);
  const requestId = String((body as { requestId?: string })?.requestId || "");
  const action = String((body as { action?: string })?.action || "");

  if (
    !requestId ||
    (action !== "accept" && action !== "decline" && action !== "cancel")
  ) {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }

  const actor = await actorInClan(clanId, session.user.steamId);
  if (!actor) {
    return NextResponse.json({ error: "Не найден" }, { status: 404 });
  }

  const request = await prisma.clanJoinRequest.findFirst({
    where: { id: requestId, clanId, status: "PENDING" },
  });
  if (!request) {
    return NextResponse.json({ error: "Заявка не найдена" }, { status: 404 });
  }

  if (action === "cancel") {
    if (request.userId !== actor.user.id) {
      return NextResponse.json({ error: "Нет прав" }, { status: 403 });
    }
    await prisma.clanJoinRequest.update({
      where: { id: requestId },
      data: { status: "CANCELLED" },
    });
    livePublish(
      clanLiveChannel(clanId),
      JSON.stringify({ type: "join-request" })
    );
    return NextResponse.json({ ok: true });
  }

  if (
    !actor.member ||
    !canReviewClanJoinRequests(
      actor.member.role as ClanRole,
      actor.member.title?.name
    )
  ) {
    return NextResponse.json(
      { error: "Заявки принимают глава, зам и HR" },
      { status: 403 }
    );
  }

  if (action === "decline") {
    await prisma.clanJoinRequest.update({
      where: { id: requestId },
      data: {
        status: "DECLINED",
        reviewedBy: actor.user.id,
      },
    });
    const applicant = await prisma.user.findUnique({
      where: { id: request.userId },
      select: { nick: true, name: true, steamName: true },
    });
    const clan = await prisma.clan.findUnique({
      where: { id: clanId },
      select: { tag: true },
    });
    await writeActionLog({
      category: "clan",
      action: "join_decline",
      message: `${personLabel(actor.user)} отклонил заявку ${personLabel(applicant || {})} в [${clan?.tag || "?"}]`,
      actorId: actor.user.id,
      actorNick: personLabel(actor.user),
      targetId: request.userId,
      targetNick: personLabel(applicant || {}),
      clanId,
      clanTag: clan?.tag,
    });
    livePublish(
      clanLiveChannel(clanId),
      JSON.stringify({ type: "join-request" })
    );
    livePublish(
      userLiveChannel(request.userId),
      JSON.stringify({ type: "join-request" })
    );
    return NextResponse.json({ ok: true });
  }

  const alreadyInAny = await prisma.clanMember.findFirst({
    where: { userId: request.userId },
    include: { clan: { select: { tag: true, name: true } } },
  });
  if (alreadyInAny) {
    await prisma.clanJoinRequest.update({
      where: { id: requestId },
      data: { status: "DECLINED", reviewedBy: actor.user.id },
    });
    return NextResponse.json(
      {
        error: `Игрок уже в клане [${alreadyInAny.clan.tag}]`,
      },
      { status: 409 }
    );
  }

  await prisma.$transaction([
    prisma.clanMember.create({
      data: {
        clanId,
        userId: request.userId,
        role: "MEMBER",
      },
    }),
    prisma.clanJoinRequest.update({
      where: { id: requestId },
      data: { status: "ACCEPTED", reviewedBy: actor.user.id },
    }),
    prisma.clanInvite.updateMany({
      where: { clanId, userId: request.userId, status: "PENDING" },
      data: { status: "ACCEPTED" },
    }),
    prisma.clanJoinRequest.updateMany({
      where: {
        userId: request.userId,
        status: "PENDING",
        NOT: { id: requestId },
      },
      data: { status: "CANCELLED" },
    }),
  ]);

  const applicant = await prisma.user.findUnique({
    where: { id: request.userId },
    select: { nick: true, name: true, steamName: true },
  });
  const clan = await prisma.clan.findUnique({
    where: { id: clanId },
    select: { tag: true, name: true },
  });
  await writeActionLog({
    category: "clan",
    action: "join_accept",
    message: `${personLabel(actor.user)} принял ${personLabel(applicant || {})} в [${clan?.tag || "?"}] ${clan?.name || ""}`.trim(),
    actorId: actor.user.id,
    actorNick: personLabel(actor.user),
    targetId: request.userId,
    targetNick: personLabel(applicant || {}),
    clanId,
    clanTag: clan?.tag,
  });

  livePublish(clanLiveChannel(clanId), JSON.stringify({ type: "join" }));
  livePublish(userLiveChannel(request.userId), JSON.stringify({ type: "join" }));
  return NextResponse.json({ ok: true });
}
