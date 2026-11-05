import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isBuiltinSuperAdmin } from "@/lib/admin";
import { personLabel } from "@/lib/actionLog";
import { actorNick, canTouchMember, loadFactionView, logFaction } from "@/lib/factions";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ slug: string }> };

async function gate(slug: string) {
  const session = await getServerSession(authOptions);
  const loaded = await loadFactionView(slug, session?.user?.steamId ?? null);
  if (loaded.error || !loaded.view || !loaded.me || !loaded.view.canManage) return null;
  return { view: loaded.view, me: loaded.me };
}

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const loaded = await gate(decodeURIComponent(slug));
  if (!loaded) return NextResponse.json({ error: "Нет доступа" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { userId?: string } | null;
  const userId = String(body?.userId || "").trim();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, nick: true, name: true, steamName: true, steamId: true },
  });
  if (!user || isBuiltinSuperAdmin(user.steamId)) {
    return NextResponse.json({ error: "Выбери игрока из клана" }, { status: 400 });
  }
  const inClan = await prisma.clanMember.findUnique({
    where: { clanId_userId: { clanId: loaded.view.clanId, userId: user.id } },
  });
  if (!inClan) {
    return NextResponse.json({ error: "Игрок не в клане BlackBerry" }, { status: 400 });
  }
  const elsewhere = await prisma.factionMember.findUnique({ where: { userId: user.id } });
  if (elsewhere) {
    return NextResponse.json({ error: "Игрок уже состоит в фракции" }, { status: 409 });
  }
  const existing = await prisma.factionInvite.findFirst({
    where: { factionId: loaded.view.id, userId: user.id },
    orderBy: { createdAt: "desc" },
  });
  if (existing?.status === "PENDING") {
    return NextResponse.json({ error: "Приглашение уже отправлено" }, { status: 409 });
  }
  if (existing && (existing.status === "DECLINED" || existing.status === "CANCELLED")) {
    await prisma.factionInvite.update({
      where: { id: existing.id },
      data: { status: "PENDING", invitedBy: loaded.me.id },
    });
  } else {
    await prisma.factionInvite.create({
      data: {
        factionId: loaded.view.id,
        userId: user.id,
        invitedBy: loaded.me.id,
        status: "PENDING",
      },
    });
  }
  return NextResponse.json({ ok: true, invited: true });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const loaded = await gate(decodeURIComponent(slug));
  if (!loaded) return NextResponse.json({ error: "Нет доступа" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as {
    userId?: string;
    roleId?: string | null;
  } | null;
  const userId = String(body?.userId || "");
  const member = await prisma.factionMember.findFirst({
    where: { factionId: loaded.view.id, userId },
  });
  if (!member) return NextResponse.json({ error: "Нет в составе" }, { status: 404 });
  const actor = { keech: loaded.view.keech, seat: loaded.view.mySeat };
  if (!canTouchMember(actor, member.seat) || member.seat === "LEADER") {
    return NextResponse.json({ error: "Роль главы не трогаем" }, { status: 403 });
  }
  const roleId = body?.roleId ? String(body.roleId) : null;
  if (!roleId) {
    await prisma.factionMember.update({
      where: { id: member.id },
      data: { roleId: null, seat: "MEMBER" },
    });
    return NextResponse.json({ ok: true });
  }
  const role = await prisma.factionRole.findFirst({
    where: { id: roleId, factionId: loaded.view.id },
  });
  if (!role) return NextResponse.json({ error: "Роль не найдена" }, { status: 404 });
  await prisma.factionMember.update({
    where: { id: member.id },
    data: { roleId: role.id, seat: role.isDeputy ? "DEPUTY" : "MEMBER" },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const loaded = await gate(decodeURIComponent(slug));
  if (!loaded) return NextResponse.json({ error: "Нет доступа" }, { status: 404 });
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId") || "";
  const member = await prisma.factionMember.findFirst({
    where: { factionId: loaded.view.id, userId },
    include: { user: { select: { id: true, nick: true, name: true, steamName: true, steamId: true } } },
  });
  if (!member || isBuiltinSuperAdmin(member.user.steamId)) {
    return NextResponse.json({ error: "Нет в составе" }, { status: 404 });
  }
  if (member.userId === loaded.me.id && !loaded.view.keech) {
    return NextResponse.json({ error: "Самим выйти из фракции нельзя" }, { status: 403 });
  }
  const actor = { keech: loaded.view.keech, seat: loaded.view.mySeat };
  if (!canTouchMember(actor, member.seat)) {
    return NextResponse.json({ error: "Главу исключить нельзя" }, { status: 403 });
  }
  if (member.seat === "LEADER" && !loaded.view.keech) {
    return NextResponse.json({ error: "Главу исключить нельзя" }, { status: 403 });
  }
  await prisma.factionMember.delete({ where: { id: member.id } });
  await logFaction("kick", {
    actorId: loaded.me.id,
    actorNick: actorNick(loaded.me, loaded.view.keech),
    targetId: member.user.id,
    targetNick: personLabel(member.user),
    factionName: loaded.view.name,
    clanId: loaded.view.clanId,
  });
  return NextResponse.json({ ok: true });
}
