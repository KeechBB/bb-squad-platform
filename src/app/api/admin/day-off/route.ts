import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/requireAdmin";
import {
  correctDayOffEnteredAt,
  enterDayOff,
  exitDayOff,
  userOnDayOff,
} from "@/lib/dayOff";
import {
  parseFutureOrTodayDate,
  parseRuCalendarDate,
  formatRuDate,
} from "@/lib/validation";
import { getUserRole } from "@/lib/admin";
import type { AppRole } from "@/lib/roles";
import { findBlackberryClanIds } from "@/lib/reserve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function canManage(role: AppRole | null): boolean {
  return role === "SUPER_ADMIN" || role === "DEPUTY" || role === "HR";
}

/** GET — BB + кто на выходном + история */
export async function GET(req: Request) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  const role = await getUserRole(gate.session!.user.steamId);
  if (!canManage(role)) {
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
                dayOffUntil: true,
                dayOffReason: true,
                profileComplete: true,
                regNo: true,
              },
            },
            clan: { select: { id: true, tag: true, name: true } },
          },
          orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
        });

  const openStints = await prisma.dayOffStint.findMany({
    where: { exitedAt: null },
    select: {
      id: true,
      userId: true,
      enteredAt: true,
      untilAt: true,
      reason: true,
      source: true,
    },
  });
  const openByUser = new Map(openStints.map((s) => [s.userId, s]));

  const seen = new Set<string>();
  const players = [];
  for (const m of members) {
    const u = m.user;
    if (!u || seen.has(u.id)) continue;
    seen.add(u.id);
    const open = openByUser.get(u.id);
    const on = userOnDayOff(u);
    players.push({
      userId: u.id,
      nick: u.nick,
      name: u.name,
      steamName: u.steamName,
      steamId: u.steamId,
      regNo: u.regNo,
      clanTag: m.clan.tag,
      clanRole: m.role,
      inDayOff: on,
      stintId: on ? open?.id || null : null,
      reason: on ? u.dayOffReason || open?.reason || null : null,
      enteredAt: on && open ? open.enteredAt.toISOString() : null,
      untilAt: on && u.dayOffUntil ? u.dayOffUntil.toISOString() : null,
      untilLabel:
        on && u.dayOffUntil ? formatRuDate(u.dayOffUntil) : null,
      enteredLabel: on && open ? formatRuDate(open.enteredAt) : null,
    });
  }

  let history: Array<{
    id: string;
    enteredAt: string;
    untilAt: string;
    exitedAt: string | null;
    reason: string;
    source: string;
    enteredBy: string | null;
    exitedBy: string | null;
    open: boolean;
  }> = [];

  if (historyUserId) {
    const rows = await prisma.dayOffStint.findMany({
      where: { userId: historyUserId },
      orderBy: { enteredAt: "desc" },
      take: 40,
      include: {
        enteredBy: {
          select: { nick: true, steamName: true, steamId: true },
        },
        exitedBy: {
          select: { nick: true, steamName: true, steamId: true },
        },
      },
    });
    history = rows.map((s) => ({
      id: s.id,
      enteredAt: s.enteredAt.toISOString(),
      untilAt: s.untilAt.toISOString(),
      exitedAt: s.exitedAt?.toISOString() ?? null,
      reason: s.reason,
      source: s.source,
      enteredBy:
        s.enteredBy?.nick ||
        s.enteredBy?.steamName ||
        s.enteredBy?.steamId ||
        null,
      exitedBy:
        s.exitedBy?.nick ||
        s.exitedBy?.steamName ||
        s.exitedBy?.steamId ||
        null,
      open: s.exitedAt == null,
    }));
  }

  return NextResponse.json({
    players,
    inDayOffCount: players.filter((p) => p.inDayOff).length,
    total: players.length,
    history,
  });
}

export async function POST(req: Request) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  const role = await getUserRole(gate.session!.user.steamId);
  if (!canManage(role)) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const userId = String((body as { userId?: string })?.userId || "").trim();
  const untilRaw = String((body as { until?: string })?.until || "").trim();
  const fromRaw = String((body as { from?: string })?.from || "").trim();
  const reason = String((body as { reason?: string })?.reason || "").trim();

  if (!userId) {
    return NextResponse.json({ error: "userId обязателен" }, { status: 400 });
  }

  // Админ: until может быть в прошлом (задним числом закрытый период)
  let until = parseFutureOrTodayDate(untilRaw);
  if (!until) {
    until = parseRuCalendarDate(untilRaw);
  }
  if (!until) {
    return NextResponse.json(
      { error: "Дата до (ДД.ММ.ГГГГ)" },
      { status: 400 }
    );
  }

  let enteredAt: Date | undefined;
  if (fromRaw) {
    const from = parseRuCalendarDate(fromRaw);
    if (!from) {
      return NextResponse.json(
        { error: "Дата с (ДД.ММ.ГГГГ)" },
        { status: 400 }
      );
    }
    enteredAt = from;
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
    const { user } = await enterDayOff({
      userId,
      until,
      reason,
      source: "admin",
      actor,
      enteredAt,
    });
    return NextResponse.json({ ok: true, dayOff: user });
  } catch (e) {
    if (e instanceof Error && e.message === "user_not_found") {
      return NextResponse.json({ error: "Игрок не найден" }, { status: 404 });
    }
    if (e instanceof Error && e.message === "day_off_range") {
      return NextResponse.json(
        { error: "Дата «до» должна быть не раньше даты начала" },
        { status: 400 }
      );
    }
    throw e;
  }
}

export async function PATCH(req: Request) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  const role = await getUserRole(gate.session!.user.steamId);
  if (!canManage(role)) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const stintId = String((body as { stintId?: string })?.stintId || "").trim();
  const enteredRaw = String(
    (body as { enteredAt?: string })?.enteredAt || ""
  ).trim();

  if (!stintId) {
    return NextResponse.json({ error: "stintId обязателен" }, { status: 400 });
  }
  const enteredAt = parseRuCalendarDate(enteredRaw);
  if (!enteredAt) {
    return NextResponse.json(
      { error: "Дата начала: ДД.ММ.ГГГГ" },
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
    const { stint } = await correctDayOffEnteredAt({
      stintId,
      enteredAt,
      actor,
    });
    return NextResponse.json({
      ok: true,
      stint: {
        id: stint.id,
        enteredAt: stint.enteredAt.toISOString(),
        enteredLabel: formatRuDate(stint.enteredAt),
      },
    });
  } catch (e) {
    if (e instanceof Error) {
      if (e.message === "stint_not_found") {
        return NextResponse.json({ error: "Запись не найдена" }, { status: 404 });
      }
      if (e.message === "entered_after_exit") {
        return NextResponse.json(
          { error: "Дата начала позже выхода" },
          { status: 400 }
        );
      }
      if (e.message === "entered_after_until") {
        return NextResponse.json(
          { error: "Дата начала позже срока «до»" },
          { status: 400 }
        );
      }
    }
    throw e;
  }
}

export async function DELETE(req: Request) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  const role = await getUserRole(gate.session!.user.steamId);
  if (!canManage(role)) {
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
    const { user } = await exitDayOff({
      userId,
      source: "admin",
      actor,
    });
    return NextResponse.json({ ok: true, dayOff: user });
  } catch (e) {
    if (e instanceof Error && e.message === "user_not_found") {
      return NextResponse.json({ error: "Игрок не найден" }, { status: 404 });
    }
    throw e;
  }
}
