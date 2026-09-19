import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageClanMembers } from "@/lib/clan";
import { ensureDefaultSquads } from "@/lib/squads";

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
  const { id: clanId } = await ctx.params;
  await ensureDefaultSquads(clanId);
  const squads = await prisma.clanSquad.findMany({
    where: { clanId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
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
            },
          },
        },
        orderBy: { joinedAt: "asc" },
      },
    },
  });
  return NextResponse.json({ squads });
}

export async function POST(req: Request, ctx: Ctx) {
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
  const name = String((body as { name?: string })?.name || "").trim();
  if (name.length < 2 || name.length > 24) {
    return NextResponse.json({ error: "Название состава: 2–24 символа" }, { status: 400 });
  }

  const count = await prisma.clanSquad.count({ where: { clanId } });
  try {
    const squad = await prisma.clanSquad.create({
      data: { clanId, name, sortOrder: count + 10 },
      include: { members: true },
    });
    return NextResponse.json({ ok: true, squad });
  } catch {
    return NextResponse.json({ error: "Такой состав уже есть" }, { status: 409 });
  }
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
  const squadId = String((body as { squadId?: string })?.squadId || "");
  const userId = String((body as { userId?: string })?.userId || "");
  const action = String((body as { action?: string })?.action || "");

  if (!squadId || !userId || (action !== "add" && action !== "remove")) {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }

  const squad = await prisma.clanSquad.findFirst({ where: { id: squadId, clanId } });
  if (!squad) {
    return NextResponse.json({ error: "Состав не найден" }, { status: 404 });
  }

  const inClan = await prisma.clanMember.findUnique({
    where: { clanId_userId: { clanId, userId } },
  });
  if (!inClan) {
    return NextResponse.json({ error: "Игрок не в клане" }, { status: 400 });
  }

  if (action === "remove") {
    await prisma.clanSquadMember.deleteMany({ where: { squadId, userId } });
    return NextResponse.json({ ok: true });
  }

  // один состав на клан: убрать из других составов этого клана
  const other = await prisma.clanSquad.findMany({
    where: { clanId, NOT: { id: squadId } },
    select: { id: true },
  });
  if (other.length) {
    await prisma.clanSquadMember.deleteMany({
      where: {
        userId,
        squadId: { in: other.map((s) => s.id) },
      },
    });
  }

  await prisma.clanSquadMember.upsert({
    where: { squadId_userId: { squadId, userId } },
    create: { squadId, userId },
    update: {},
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }
  const { id: clanId } = await ctx.params;
  const actor = await actorMembership(clanId, session.user.steamId);
  if (!actor || actor.member.role !== "LEADER") {
    return NextResponse.json({ error: "Только глава может удалять составы" }, { status: 403 });
  }

  const url = new URL(req.url);
  const squadId = url.searchParams.get("squadId") || "";
  const squad = await prisma.clanSquad.findFirst({ where: { id: squadId, clanId } });
  if (!squad) {
    return NextResponse.json({ error: "Состав не найден" }, { status: 404 });
  }
  if (["main", "junior"].includes(squad.name.toLowerCase())) {
    return NextResponse.json(
      { error: "Main и Junior нельзя удалить" },
      { status: 403 }
    );
  }

  await prisma.clanSquad.delete({ where: { id: squadId } });
  return NextResponse.json({ ok: true });
}
