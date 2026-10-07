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

/**
 * GET /api/kits?userId=… | steamId=…
 *   day=YYYY-MM-DD — сутки МСК
 *   from=&to= — интервал МСК включительно
 *   days=1 — список дней со спавнами
 *   lane=TR1|PB1 — сервер (по умолчанию TR1)
 *   combat=0 — без окна 21:30–01:00 (соперники / КВ)
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const userId = (url.searchParams.get("userId") || "").trim();
  const steamRaw = (url.searchParams.get("steamId") || "").trim();
  const steamId = normalizeSteamId(steamRaw) || steamRaw || "";
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
  const combatWindow = url.searchParams.get("combat") !== "0";

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
    kits: stats.kits,
    total: stats.total,
    days: days || undefined,
  });
}
