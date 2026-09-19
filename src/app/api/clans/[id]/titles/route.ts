import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { ClanRole } from "@/lib/clan";
import {
  canAssignTitleToMember,
  canManageClanTitles,
  ensureDefaultTitles,
  isValidTitleName,
} from "@/lib/titles";
import { clanLiveChannel, livePublish } from "@/lib/liveBus";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

async function actorInClan(clanId: string, steamId: string) {
  const user = await prisma.user.findUnique({ where: { steamId } });
  if (!user) return null;
  const member = await prisma.clanMember.findUnique({
    where: { clanId_userId: { clanId, userId: user.id } },
    include: { title: { select: { name: true } } },
  });
  if (!member) return null;
  return { user, member };
}

export async function GET(_req: Request, ctx: Ctx) {
  const { id: clanId } = await ctx.params;
  await ensureDefaultTitles(clanId);
  const titles = await prisma.clanTitle.findMany({
    where: { clanId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return NextResponse.json({ titles });
}

export async function POST(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }
  const { id: clanId } = await ctx.params;
  await ensureDefaultTitles(clanId);

  const actor = await actorInClan(clanId, session.user.steamId);
  if (
    !actor ||
    !canManageClanTitles(
      actor.member.role as ClanRole,
      actor.member.title?.name
    )
  ) {
    return NextResponse.json(
      { error: "Должности создают глава клана и HR" },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => null);
  const name = String((body as { name?: string })?.name || "").trim();
  if (!isValidTitleName(name)) {
    return NextResponse.json(
      { error: "Название должности: 2–32 символа" },
      { status: 400 }
    );
  }

  const taken = await prisma.clanTitle.findFirst({
    where: { clanId, name: { equals: name, mode: "insensitive" } },
  });
  if (taken) {
    return NextResponse.json({ error: "Такая должность уже есть" }, { status: 409 });
  }

  const count = await prisma.clanTitle.count({ where: { clanId } });
  const title = await prisma.clanTitle.create({
    data: { clanId, name, sortOrder: count + 10 },
  });
  livePublish(clanLiveChannel(clanId), JSON.stringify({ type: "title" }));
  return NextResponse.json({ ok: true, title });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }
  const { id: clanId } = await ctx.params;
  await ensureDefaultTitles(clanId);

  const actor = await actorInClan(clanId, session.user.steamId);
  if (
    !actor ||
    !canManageClanTitles(
      actor.member.role as ClanRole,
      actor.member.title?.name
    )
  ) {
    return NextResponse.json(
      { error: "Должности выдают глава клана и HR" },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => null);
  const memberId = String((body as { memberId?: string })?.memberId || "");
  const titleIdRaw = (body as { titleId?: string | null })?.titleId;
  const titleId =
    titleIdRaw === null || titleIdRaw === "" || titleIdRaw === undefined
      ? null
      : String(titleIdRaw);

  if (!memberId) {
    return NextResponse.json({ error: "Не указан участник" }, { status: 400 });
  }

  const target = await prisma.clanMember.findFirst({
    where: { id: memberId, clanId },
  });
  if (!target) {
    return NextResponse.json({ error: "Участник не найден" }, { status: 404 });
  }

  if (
    !canAssignTitleToMember(
      actor.member.role as ClanRole,
      target.role as ClanRole
    )
  ) {
    return NextResponse.json(
      { error: "HR не может менять должность главе клана" },
      { status: 403 }
    );
  }

  if (titleId) {
    const title = await prisma.clanTitle.findFirst({
      where: { id: titleId, clanId },
    });
    if (!title) {
      return NextResponse.json({ error: "Должность не найдена" }, { status: 404 });
    }
  }

  const member = await prisma.clanMember.update({
    where: { id: memberId },
    data: { titleId },
    include: { title: true },
  });
  livePublish(clanLiveChannel(clanId), JSON.stringify({ type: "title" }));
  return NextResponse.json({ ok: true, member });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }
  const { id: clanId } = await ctx.params;
  const actor = await actorInClan(clanId, session.user.steamId);
  if (
    !actor ||
    !canManageClanTitles(
      actor.member.role as ClanRole,
      actor.member.title?.name
    )
  ) {
    return NextResponse.json(
      { error: "Должности удаляют глава клана и HR" },
      { status: 403 }
    );
  }

  const url = new URL(req.url);
  const titleId = url.searchParams.get("titleId") || "";
  if (!titleId) {
    return NextResponse.json({ error: "Не указана должность" }, { status: 400 });
  }

  const title = await prisma.clanTitle.findFirst({
    where: { id: titleId, clanId },
  });
  if (!title) {
    return NextResponse.json({ error: "Должность не найдена" }, { status: 404 });
  }

  await prisma.clanMember.updateMany({
    where: { clanId, titleId },
    data: { titleId: null },
  });
  await prisma.clanTitle.delete({ where: { id: titleId } });
  livePublish(clanLiveChannel(clanId), JSON.stringify({ type: "title" }));
  return NextResponse.json({ ok: true });
}
