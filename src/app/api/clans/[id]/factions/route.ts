import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isBuiltinSuperAdmin } from "@/lib/admin";
import {
  DEPUTY_ROLE_NAME,
  factionPath,
  factionSlug,
  isBlackberryClan,
  logFaction,
  actorNick,
} from "@/lib/factions";
import { personLabel, writeActionLog } from "@/lib/actionLog";
import { removeFactionLogo } from "@/lib/factionLogoFile";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !isBuiltinSuperAdmin(session.user.steamId)) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 404 });
  }
  const { id } = await ctx.params;
  const clan = await prisma.clan.findUnique({
    where: { id },
    select: { id: true, tag: true, isExternal: true },
  });
  if (!clan || !isBlackberryClan(clan)) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 404 });
  }
  const factions = await prisma.faction.findMany({
    where: { clanId: id },
    orderBy: { name: "asc" },
    include: {
      members: {
        where: { seat: "LEADER" },
        include: { user: { select: { nick: true, steamName: true, steamId: true } } },
      },
      _count: { select: { members: true } },
    },
  });
  const clanMembers = await prisma.clanMember.findMany({
    where: { clanId: id },
    include: {
      user: { select: { id: true, nick: true, name: true, steamName: true, steamId: true } },
    },
    orderBy: { user: { nick: "asc" } },
  });
  const taken = new Set(
    (await prisma.factionMember.findMany({ select: { userId: true } })).map((m) => m.userId)
  );
  const candidates = clanMembers
    .filter((m) => !isBuiltinSuperAdmin(m.user.steamId) && !taken.has(m.user.id))
    .map((m) => ({
      id: m.user.id,
      nick: m.user.nick || m.user.steamName || "—",
      name: m.user.name || "",
    }));

  return NextResponse.json({
    candidates,
    factions: factions.map((f) => {
      const leader = f.members.find((m) => !isBuiltinSuperAdmin(m.user.steamId));
      return {
        id: f.id,
        name: f.name,
        slug: f.slug,
        href: factionPath(f.slug),
        logoUrl: f.logoUrl,
        leaderNick: leader ? leader.user.nick || leader.user.steamName || "—" : "глава не назначен",
        members: f._count.members,
      };
    }),
  });
}

export async function POST(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !isBuiltinSuperAdmin(session.user.steamId)) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 404 });
  }
  const { id: clanId } = await ctx.params;
  const clan = await prisma.clan.findUnique({
    where: { id: clanId },
    select: { id: true, tag: true, isExternal: true },
  });
  if (!clan || !isBlackberryClan(clan)) {
    return NextResponse.json({ error: "Только клан BlackBerry" }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as {
    name?: string;
    leaderUserId?: string;
  } | null;
  const name = String(body?.name || "").trim();
  const leaderUserId = String(body?.leaderUserId || "").trim();
  if (name.length < 2 || name.length > 32) {
    return NextResponse.json({ error: "Название от 2 до 32 символов" }, { status: 400 });
  }
  const slug = factionSlug(name);
  if (slug.length < 2) {
    return NextResponse.json({ error: "В названии нужны буквы" }, { status: 400 });
  }
  const taken = await prisma.faction.findUnique({ where: { slug } });
  if (taken) {
    return NextResponse.json({ error: "Фракция с таким названием уже есть" }, { status: 409 });
  }

  const leader = await prisma.user.findUnique({
    where: { id: leaderUserId },
    select: { id: true, nick: true, name: true, steamName: true, steamId: true },
  });
  if (!leader || isBuiltinSuperAdmin(leader.steamId)) {
    return NextResponse.json({ error: "Выбери главу из клана" }, { status: 400 });
  }
  const inClan = await prisma.clanMember.findUnique({
    where: { clanId_userId: { clanId, userId: leader.id } },
  });
  if (!inClan) {
    return NextResponse.json({ error: "Глава должен быть в клане BlackBerry" }, { status: 400 });
  }
  const elsewhere = await prisma.factionMember.findUnique({ where: { userId: leader.id } });
  if (elsewhere) {
    return NextResponse.json({ error: "Этот игрок уже в другой фракции" }, { status: 409 });
  }

  const me = await prisma.user.findUnique({
    where: { steamId: session.user.steamId },
    select: { id: true, nick: true, name: true, steamName: true },
  });

  const faction = await prisma.faction.create({
    data: {
      clanId,
      name,
      slug,
      roles: { create: { name: DEPUTY_ROLE_NAME, isDeputy: true, sortOrder: 0 } },
      members: { create: { userId: leader.id, seat: "LEADER" } },
    },
  });

  await logFaction("join", {
    actorId: me?.id ?? null,
    actorNick: actorNick(me, true),
    targetId: leader.id,
    targetNick: personLabel(leader),
    factionName: name,
    clanId,
    how: "глава",
  });

  return NextResponse.json({ ok: true, slug: faction.slug, href: factionPath(faction.slug) });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !isBuiltinSuperAdmin(session.user.steamId)) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 404 });
  }
  const { id: clanId } = await ctx.params;
  const clan = await prisma.clan.findUnique({
    where: { id: clanId },
    select: { id: true, tag: true, isExternal: true },
  });
  if (!clan || !isBlackberryClan(clan)) {
    return NextResponse.json({ error: "Только клан BlackBerry" }, { status: 404 });
  }
  const factionId = new URL(req.url).searchParams.get("factionId")?.trim() || "";
  if (!factionId) {
    return NextResponse.json({ error: "Не выбрана фракция" }, { status: 400 });
  }
  const faction = await prisma.faction.findFirst({
    where: { id: factionId, clanId },
    select: { id: true, name: true },
  });
  if (!faction) {
    return NextResponse.json({ error: "Фракция не найдена" }, { status: 404 });
  }

  const me = await prisma.user.findUnique({
    where: { steamId: session.user.steamId },
    select: { id: true, nick: true, name: true, steamName: true },
  });

  await prisma.faction.delete({ where: { id: faction.id } });
  await removeFactionLogo(faction.id);
  await writeActionLog({
    category: "faction",
    action: "faction_delete",
    message: `Фракция «${faction.name}» удалена. Сделал ${actorNick(me, true)}.`,
    actorId: me?.id ?? null,
    actorNick: actorNick(me, true),
    clanId,
    clanTag: "BB",
    meta: { faction: faction.name },
  });

  return NextResponse.json({ ok: true });
}
