import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/requireAdmin";
import {
  enterReserve,
  exitReserve,
  findBlackberryClanIds,
  userInReserve,
} from "@/lib/reserve";
import { parseFutureOrTodayDate, formatRuDate } from "@/lib/validation";
import { getUserRole } from "@/lib/admin";
import type { AppRole } from "@/lib/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function canManageReserve(role: AppRole | null): boolean {
  return role === "SUPER_ADMIN" || role === "DEPUTY" || role === "HR";
}

/** GET — список BB + история резервов */
export async function GET(req: Request) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  const role = await getUserRole(gate.session!.user.steamId);
  if (!canManageReserve(role)) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 403 });
  }

  const url = new URL(req.url);
  const historyUserId = url.searchParams.get("historyUserId")?.trim() || "";

  const clanIds = await findBlackberryClanIds();

  const members =
    clanIds.length === 0
      ? []
      : await prisma.clanMember.findMany({
          where: { clanId: { in: clanIds } },
          include: {
            user: {
              select: {
                id: true,
                nick: true,
                name: true,
                steamName: true,
                steamId: true,
                reserveUntil: true,
                reserveReason: true,
                profileComplete: true,
                regNo: true,
              },
            },
            clan: { select: { id: true, tag: true, name: true } },
          },
          orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
        });

  // Открытые stint'ы для даты ухода
  const openStints = await prisma.reserveStint.findMany({
    where: { exitedAt: null },
    select: {
      id: true,
      userId: true,
      enteredAt: true,
      untilAt: true,
      reason: true,
      source: true,
      enteredBy: {
        select: { nick: true, steamName: true, steamId: true },
      },
    },
  });
  const openByUser = new Map(openStints.map((s) => [s.userId, s]));

  // Бэкофилл: если в резерве по User, но нет открытого stint
  for (const m of members) {
    const u = m.user;
    if (userInReserve(u) && u.reserveUntil && !openByUser.has(u.id)) {
      const stint = await prisma.reserveStint.create({
        data: {
          userId: u.id,
          enteredAt: new Date(),
          untilAt: u.reserveUntil,
          reason: u.reserveReason || "(без причины — импорт)",
          source: "admin",
        },
        select: {
          id: true,
          userId: true,
          enteredAt: true,
          untilAt: true,
          reason: true,
          source: true,
          enteredBy: {
            select: { nick: true, steamName: true, steamId: true },
          },
        },
      });
      openByUser.set(u.id, stint);
    }
  }

  const players = members.map((m) => {
    const u = m.user;
    const inReserve = userInReserve(u);
    const open = openByUser.get(u.id) || null;
    return {
      userId: u.id,
      nick: u.nick,
      name: u.name,
      steamName: u.steamName,
      steamId: u.steamId,
      regNo: u.regNo,
      clanTag: m.clan.tag,
      clanRole: m.role,
      inReserve,
      reason: inReserve ? u.reserveReason || open?.reason || null : null,
      enteredAt: inReserve && open ? open.enteredAt.toISOString() : null,
      untilAt: inReserve && u.reserveUntil ? u.reserveUntil.toISOString() : null,
      untilLabel:
        inReserve && u.reserveUntil ? formatRuDate(u.reserveUntil) : null,
      enteredLabel:
        inReserve && open ? formatRuDate(open.enteredAt) : null,
    };
  });

  // Уникальные по userId (если в нескольких BB-кланах)
  const seen = new Set<string>();
  const unique = players.filter((p) => {
    if (seen.has(p.userId)) return false;
    seen.add(p.userId);
    return true;
  });

  unique.sort((a, b) => {
    if (a.inReserve !== b.inReserve) return a.inReserve ? -1 : 1;
    return (a.nick || a.steamName || "").localeCompare(
      b.nick || b.steamName || "",
      "ru"
    );
  });

  let history: unknown[] = [];
  if (historyUserId) {
    const rows = await prisma.reserveStint.findMany({
      where: { userId: historyUserId },
      orderBy: { enteredAt: "desc" },
      take: 50,
      include: {
        enteredBy: {
          select: { nick: true, steamName: true, steamId: true },
        },
        exitedBy: {
          select: { nick: true, steamName: true, steamId: true },
        },
      },
    });
    history = rows.map((r) => ({
      id: r.id,
      enteredAt: r.enteredAt.toISOString(),
      untilAt: r.untilAt.toISOString(),
      exitedAt: r.exitedAt?.toISOString() ?? null,
      reason: r.reason,
      source: r.source,
      enteredBy: r.enteredBy
        ? r.enteredBy.nick || r.enteredBy.steamName || r.enteredBy.steamId
        : null,
      exitedBy: r.exitedBy
        ? r.exitedBy.nick || r.exitedBy.steamName || r.exitedBy.steamId
        : null,
      open: r.exitedAt == null,
    }));
  }

  return NextResponse.json({
    clanIds,
    players: unique,
    inReserveCount: unique.filter((p) => p.inReserve).length,
    total: unique.length,
    history,
  });
}

/** POST — админ кладёт в резерв */
export async function POST(req: Request) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  const role = await getUserRole(gate.session!.user.steamId);
  if (!canManageReserve(role)) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const userId = String((body as { userId?: string })?.userId || "").trim();
  const untilRaw = String((body as { until?: string })?.until || "").trim();
  const reason = String((body as { reason?: string })?.reason || "").trim();

  if (!userId) {
    return NextResponse.json({ error: "userId обязателен" }, { status: 400 });
  }
  const until = parseFutureOrTodayDate(untilRaw);
  if (!until) {
    return NextResponse.json(
      { error: "Дата до (ДД.ММ.ГГГГ), не в прошлом" },
      { status: 400 }
    );
  }
  if (reason.length < 3 || reason.length > 300) {
    return NextResponse.json(
      { error: "Причина: от 3 до 300 символов" },
      { status: 400 }
    );
  }

  const actor = await prisma.user.findUnique({
    where: { steamId: gate.session!.user.steamId },
    select: {
      id: true,
      nick: true,
      name: true,
      steamName: true,
      steamId: true,
    },
  });
  if (!actor) {
    return NextResponse.json({ error: "Актор не найден" }, { status: 404 });
  }

  try {
    const { user } = await enterReserve({
      userId,
      until,
      reason,
      source: "admin",
      actor,
    });
    return NextResponse.json({ ok: true, reserve: user });
  } catch (e) {
    if (e instanceof Error && e.message === "user_not_found") {
      return NextResponse.json({ error: "Игрок не найден" }, { status: 404 });
    }
    throw e;
  }
}

/** DELETE — админ вытаскивает из резерва ?userId= */
export async function DELETE(req: Request) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  const role = await getUserRole(gate.session!.user.steamId);
  if (!canManageReserve(role)) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 403 });
  }

  const url = new URL(req.url);
  const userId = url.searchParams.get("userId")?.trim() || "";
  if (!userId) {
    return NextResponse.json({ error: "userId обязателен" }, { status: 400 });
  }

  const actor = await prisma.user.findUnique({
    where: { steamId: gate.session!.user.steamId },
    select: {
      id: true,
      nick: true,
      name: true,
      steamName: true,
      steamId: true,
    },
  });
  if (!actor) {
    return NextResponse.json({ error: "Актор не найден" }, { status: 404 });
  }

  try {
    const { user } = await exitReserve({
      userId,
      source: "admin",
      actor,
    });
    return NextResponse.json({ ok: true, reserve: user });
  } catch (e) {
    if (e instanceof Error && e.message === "user_not_found") {
      return NextResponse.json({ error: "Игрок не найден" }, { status: 404 });
    }
    throw e;
  }
}
