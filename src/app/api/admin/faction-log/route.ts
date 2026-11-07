import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/requireAdmin";
import { personLabel } from "@/lib/actionLog";
import { actorNick, logFaction } from "@/lib/factions";
import { isBuiltinSuperAdmin } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function metaReason(meta: unknown): string | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const reason = (meta as Record<string, unknown>).reason;
  return typeof reason === "string" && reason.trim() ? reason.trim() : null;
}

function metaFaction(meta: unknown): string | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const f = (meta as Record<string, unknown>).faction;
  return typeof f === "string" && f.trim() ? f.trim() : null;
}

/** GET — лог вступлений / исключений из фракций (+ список фракций для формы). */
export async function GET(req: Request) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;

  const url = new URL(req.url);
  const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
  const limitRaw = Number(url.searchParams.get("limit") || "300");
  const limit = Math.min(500, Math.max(20, Number.isFinite(limitRaw) ? limitRaw : 300));

  const [rows, factions] = await Promise.all([
    prisma.actionLog.findMany({
      where: {
        category: "faction",
        ...(q
          ? { searchText: { contains: q, mode: "insensitive" as const } }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.faction.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, slug: true, clanId: true },
    }),
  ]);

  return NextResponse.json({
    factions,
    entries: rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      action: r.action,
      kind: r.action === "faction_kick" ? "kick" : "join",
      message: r.message,
      targetNick: r.targetNick,
      actorNick: r.actorNick,
      faction: metaFaction(r.meta),
      reason: metaReason(r.meta),
    })),
  });
}

/** POST — добавить или исключить игрока из фракции (админ-панель). */
export async function POST(req: Request) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;

  const body = (await req.json().catch(() => null)) as {
    nick?: string;
    factionSlug?: string;
    action?: "join" | "kick";
    reason?: string;
  } | null;

  const nick = String(body?.nick || "").trim();
  const factionSlug = String(body?.factionSlug || "").trim();
  const action = body?.action === "kick" ? "kick" : "join";
  const reason = String(body?.reason || "").trim();

  if (nick.length < 2 || !factionSlug) {
    return NextResponse.json({ error: "Нужны ник и фракция" }, { status: 400 });
  }
  if (action === "kick" && reason.length < 3) {
    return NextResponse.json(
      { error: "При исключении укажи причину (минимум 3 символа)" },
      { status: 400 }
    );
  }

  const faction = await prisma.faction.findFirst({
    where: { slug: factionSlug },
    select: { id: true, name: true, slug: true, clanId: true },
  });
  if (!faction) {
    return NextResponse.json({ error: "Фракция не найдена" }, { status: 404 });
  }

  const nickKey = nick.toLowerCase();
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { nick: { equals: nick, mode: "insensitive" } },
        { steamName: { equals: nick, mode: "insensitive" } },
        { steamId: nick },
      ],
    },
    select: { id: true, nick: true, name: true, steamName: true, steamId: true },
  });
  if (!user || isBuiltinSuperAdmin(user.steamId)) {
    return NextResponse.json({ error: `Игрок «${nick}» не найден` }, { status: 404 });
  }
  // Prefer exact nick match if several (unlikely)
  void nickKey;

  const inClan = await prisma.clanMember.findUnique({
    where: { clanId_userId: { clanId: faction.clanId, userId: user.id } },
  });
  if (!inClan) {
    return NextResponse.json(
      { error: "Игрок не в клане BlackBerry" },
      { status: 400 }
    );
  }

  const steamId = gate.session?.user?.steamId;
  if (!steamId) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 403 });
  }
  const me = await prisma.user.findUnique({
    where: { steamId },
    select: { id: true, nick: true, name: true, steamName: true, steamId: true },
  });
  if (!me) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 403 });
  }
  const who = actorNick(me, isBuiltinSuperAdmin(me.steamId));

  if (action === "join") {
    const elsewhere = await prisma.factionMember.findUnique({
      where: { userId: user.id },
      include: { faction: { select: { name: true, id: true } } },
    });
    if (elsewhere && elsewhere.factionId !== faction.id) {
      return NextResponse.json(
        { error: `Уже во фракции «${elsewhere.faction.name}»` },
        { status: 409 }
      );
    }
    if (elsewhere?.factionId === faction.id) {
      return NextResponse.json({ error: "Уже в этой фракции" }, { status: 409 });
    }
    await prisma.factionMember.create({
      data: {
        factionId: faction.id,
        userId: user.id,
        seat: "MEMBER",
      },
    });
    await prisma.factionInvite.updateMany({
      where: {
        userId: user.id,
        status: { in: ["PENDING", "ACCEPTED"] },
      },
      data: { status: "CANCELLED" },
    });
    await logFaction("join", {
      actorId: me.id,
      actorNick: who,
      targetId: user.id,
      targetNick: personLabel(user),
      factionName: faction.name,
      clanId: faction.clanId,
      how: "админ-панель",
      reason: reason || undefined,
    });
    return NextResponse.json({ ok: true, action: "join" });
  }

  const member = await prisma.factionMember.findFirst({
    where: { factionId: faction.id, userId: user.id },
  });
  if (!member) {
    return NextResponse.json({ error: "Нет в этой фракции" }, { status: 404 });
  }
  if (member.seat === "LEADER" && !isBuiltinSuperAdmin(me.steamId)) {
    return NextResponse.json(
      { error: "Главу может снять только Keech" },
      { status: 403 }
    );
  }
  await prisma.factionMember.delete({ where: { id: member.id } });
  await prisma.factionInvite.updateMany({
    where: {
      factionId: faction.id,
      userId: user.id,
      status: { in: ["PENDING", "ACCEPTED"] },
    },
    data: { status: "CANCELLED" },
  });
  await logFaction("kick", {
    actorId: me.id,
    actorNick: who,
    targetId: user.id,
    targetNick: personLabel(user),
    factionName: faction.name,
    clanId: faction.clanId,
    how: "админ-панель",
    reason,
  });
  return NextResponse.json({ ok: true, action: "kick" });
}
