import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isBuiltinSuperAdmin } from "@/lib/admin";
import { personLabel } from "@/lib/actionLog";
import {
  actorNick,
  factionPath,
  factionSlug,
  loadFactionView,
  logFaction,
} from "@/lib/factions";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  const { slug } = await ctx.params;
  const loaded = await loadFactionView(decodeURIComponent(slug), session?.user?.steamId ?? null);
  if (loaded.error || !loaded.view) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }
  return NextResponse.json(loaded.view);
}

export async function PATCH(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  const { slug } = await ctx.params;
  const loaded = await loadFactionView(decodeURIComponent(slug), session?.user?.steamId ?? null);
  if (loaded.error || !loaded.view || !loaded.me) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  }
  const body = (await req.json().catch(() => null)) as {
    name?: string;
    tgUrl?: string | null;
    info?: string;
    leaderUserId?: string;
  } | null;
  if (!body) return NextResponse.json({ error: "Пусто" }, { status: 400 });

  const view = loaded.view;
  const data: { name?: string; slug?: string; tgUrl?: string | null; info?: string } = {};

  if (body.name != null || body.tgUrl !== undefined) {
    if (!view.canEditIdentity) {
      return NextResponse.json({ error: "Название и ссылку меняешь только ты" }, { status: 403 });
    }
  }
  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (name.length < 2 || name.length > 32) {
      return NextResponse.json({ error: "Название от 2 до 32 символов" }, { status: 400 });
    }
    const nextSlug = factionSlug(name);
    if (nextSlug.length < 2) {
      return NextResponse.json({ error: "В названии нужны буквы" }, { status: 400 });
    }
    if (nextSlug !== view.slug) {
      const clash = await prisma.faction.findUnique({ where: { slug: nextSlug } });
      if (clash) {
        return NextResponse.json({ error: "Такое название уже занято" }, { status: 409 });
      }
      data.slug = nextSlug;
    }
    data.name = name;
  }
  if (body.tgUrl !== undefined) {
    const raw = String(body.tgUrl || "").trim();
    if (!raw) {
      data.tgUrl = null;
    } else if (!/^https:\/\/(t\.me|telegram\.me)\//i.test(raw)) {
      return NextResponse.json({ error: "Ссылка должна начинаться с https://t.me/" }, { status: 400 });
    } else {
      data.tgUrl = raw.slice(0, 200);
    }
  }
  if (typeof body.info === "string") {
    if (!view.canEditInfo) {
      return NextResponse.json({ error: "Нет прав" }, { status: 403 });
    }
    data.info = body.info.trim().slice(0, 2000);
  }

  if (body.leaderUserId) {
    if (!view.keech) {
      return NextResponse.json({ error: "Главу назначаешь только ты" }, { status: 403 });
    }
    const nextId = String(body.leaderUserId);
    const next = await prisma.user.findUnique({
      where: { id: nextId },
      select: { id: true, nick: true, name: true, steamName: true, steamId: true },
    });
    if (!next || isBuiltinSuperAdmin(next.steamId)) {
      return NextResponse.json({ error: "Такого игрока нет" }, { status: 400 });
    }
    const inClan = await prisma.clanMember.findUnique({
      where: { clanId_userId: { clanId: view.clanId, userId: next.id } },
    });
    if (!inClan) {
      return NextResponse.json({ error: "Глава должен быть в клане" }, { status: 400 });
    }
    const current = await prisma.factionMember.findFirst({
      where: { factionId: view.id, seat: "LEADER" },
    });
    const existing = await prisma.factionMember.findUnique({ where: { userId: next.id } });
    if (existing && existing.factionId !== view.id) {
      return NextResponse.json({ error: "Игрок уже в другой фракции" }, { status: 409 });
    }
    await prisma.$transaction(async (tx) => {
      if (current && current.userId !== next.id) {
        await tx.factionMember.update({
          where: { id: current.id },
          data: { seat: "MEMBER", roleId: null },
        });
      }
      if (existing && existing.factionId === view.id) {
        await tx.factionMember.update({
          where: { id: existing.id },
          data: { seat: "LEADER", roleId: null },
        });
      } else {
        await tx.factionMember.create({
          data: { factionId: view.id, userId: next.id, seat: "LEADER" },
        });
      }
    });
    if (!existing) {
      await logFaction("join", {
        actorId: loaded.me.id,
        actorNick: actorNick(loaded.me, true),
        targetId: next.id,
        targetNick: personLabel(next),
        factionName: view.name,
        clanId: view.clanId,
        how: "глава",
      });
    }
  }

  if (Object.keys(data).length) {
    await prisma.faction.update({ where: { id: view.id }, data });
  }
  const nextSlug = data.slug || view.slug;
  return NextResponse.json({ ok: true, href: factionPath(nextSlug) });
}
