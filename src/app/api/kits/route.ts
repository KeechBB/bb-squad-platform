import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  kitDaysForUser,
  kitDaysForSteamIds,
  kitsForUser,
  kitsForSteamIds,
  type KitsLane,
} from "@/lib/squadRoles";
import { normalizeSteamId } from "@/lib/squadSessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function isBlackberryKitsSubject(
  userId: string,
  steamId: string
): Promise<boolean> {
  const { findBlackberryClanIds } = await import("@/lib/reserve");
  const clanIds = await findBlackberryClanIds();
  if (!clanIds.length) return false;
  if (userId) {
    const n = await prisma.clanMember.count({
      where: { userId, clanId: { in: clanIds } },
    });
    return n > 0;
  }
  const steam = normalizeSteamId(steamId);
  if (!steam) return false;
  const n = await prisma.clanMember.count({
    where: { clanId: { in: clanIds }, user: { steamId: steam } },
  });
  return n > 0;
}

/**
 * GET /api/kits?userId=… | steamId=…
 *   day=YYYY-MM-DD — сутки МСК
 *   from=&to= — интервал МСК включительно
 *   days=1 — список дней со спавнами
 *   lane=TR1|PB1 — сервер (по умолчанию TR1)
 *   combat=0 — без фильтра залитых TM (соперники / весь день)
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  let userId = (url.searchParams.get("userId") || "").trim();
  const steamRaw = (url.searchParams.get("steamId") || "").trim();
  const steamId = normalizeSteamId(steamRaw) || steamRaw || "";
  const nick = (url.searchParams.get("nick") || "").trim();
  if (!userId && !steamId && nick) {
    const byNick = await prisma.user.findFirst({
      where: {
        profileComplete: true,
        nick: { equals: nick, mode: "insensitive" },
      },
      select: { id: true },
    });
    if (byNick) userId = byNick.id;
  }
  if (!userId && !steamId) {
    return NextResponse.json(
      { error: "userId or steamId required" },
      { status: 400 }
    );
  }

  const day = (url.searchParams.get("day") || "").trim() || null;
  const from = (url.searchParams.get("from") || "").trim() || null;
  const to = (url.searchParams.get("to") || "").trim() || null;
  const ymdOk = (s: string | null) => !s || /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (!ymdOk(day) || !ymdOk(from) || !ymdOk(to)) {
    return NextResponse.json({ error: "bad date" }, { status: 400 });
  }
  const wantDays = url.searchParams.get("days") === "1";
  const laneRaw = (url.searchParams.get("lane") || "TR1").trim().toUpperCase();
  const lane: KitsLane = laneRaw === "PB1" ? "PB1" : "TR1";
  // Паблик (PB1) не фильтруем. У состава BlackBerry на TR — только залитые тренировки.
  let combatWindow = url.searchParams.get("combat") !== "0";
  if (lane === "TR1") {
    const bb = await isBlackberryKitsSubject(userId, steamId);
    if (bb) combatWindow = true;
  }

  if (userId) {
    const target = await prisma.user.findFirst({
      where: { id: userId, profileComplete: true },
      select: { id: true },
    });
    if (!target) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    const [stats, days] = await Promise.all([
      kitsForUser(userId, {
        dayYmd: day,
        fromYmd: from,
        toYmd: to,
        lane,
        combatWindow,
      }),
      wantDays
        ? kitDaysForUser(userId, lane, { combatWindow })
        : Promise.resolve(null),
    ]);

    return NextResponse.json({
      ok: true,
      day,
      from,
      to,
      lane,
      basis: stats.basis,
      kits: stats.kits,
      total: stats.total,
      days: days || undefined,
    });
  }

  const [stats, days] = await Promise.all([
    kitsForSteamIds([steamId], {
      dayYmd: day,
      fromYmd: from,
      toYmd: to,
      lane,
      combatWindow,
    }),
    wantDays
      ? kitDaysForSteamIds([steamId], lane, { combatWindow })
      : Promise.resolve(null),
  ]);

  return NextResponse.json({
    ok: true,
    day,
    from,
    to,
    lane,
    basis: stats.basis,
    kits: stats.kits,
    total: stats.total,
    days: days || undefined,
  });
}
