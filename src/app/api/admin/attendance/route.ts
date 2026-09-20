import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isAdmin, syncBuiltinAdmins } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { mskParts } from "@/lib/squadSessions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function rangeToUtc(fromYmd: string, toYmd: string): { from: Date; to: Date } {
  const [fy, fm, fd] = fromYmd.split("-").map(Number);
  const [ty, tm, td] = toYmd.split("-").map(Number);
  // MSK = UTC+3 → start of from-day MSK = prev day 21:00 UTC
  const from = new Date(Date.UTC(fy, fm - 1, fd, 0, 0, 0) - 3 * 3600 * 1000);
  const to = new Date(Date.UTC(ty, tm - 1, td + 1, 0, 0, 0) - 3 * 3600 * 1000);
  return { from, to };
}

function ymdMsk(d: Date): string {
  const p = mskParts(d);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function hmMsk(d: Date): string {
  const p = mskParts(d);
  return `${String(p.h).padStart(2, "0")}:${String(p.min).padStart(2, "0")}`;
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session?.user?.steamId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  await syncBuiltinAdmins();
  if (!(await isAdmin(session.user.steamId))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const now = new Date();
  const p = mskParts(now);
  const defaultTo = `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  let fromYmd = url.searchParams.get("from") || "2026-09-01";
  let toYmd = url.searchParams.get("to") || defaultTo;

  // TR1 = тренировка, PB1/TPUB1 = паблик
  const serverRaw = (url.searchParams.get("server") || "TR1").trim().toUpperCase();
  const serverKey =
    serverRaw === "PB1" || serverRaw === "TPUB1" || serverRaw === "PUB"
      ? "TPUB1"
      : "TR1";

  // clamp inclusive window to ≤ 30 days
  {
    const start = new Date(Date.UTC(
      Number(fromYmd.slice(0, 4)),
      Number(fromYmd.slice(5, 7)) - 1,
      Number(fromYmd.slice(8, 10))
    ));
    const end = new Date(Date.UTC(
      Number(toYmd.slice(0, 4)),
      Number(toYmd.slice(5, 7)) - 1,
      Number(toYmd.slice(8, 10))
    ));
    if (end < start) {
      const t = fromYmd;
      fromYmd = toYmd;
      toYmd = t;
    }
    const s2 = new Date(Date.UTC(
      Number(fromYmd.slice(0, 4)),
      Number(fromYmd.slice(5, 7)) - 1,
      Number(fromYmd.slice(8, 10))
    ));
    const e2 = new Date(Date.UTC(
      Number(toYmd.slice(0, 4)),
      Number(toYmd.slice(5, 7)) - 1,
      Number(toYmd.slice(8, 10))
    ));
    const diff = Math.round((e2.getTime() - s2.getTime()) / 86400000) + 1;
    if (diff > 30) {
      s2.setUTCDate(s2.getUTCDate() + 29);
      toYmd = `${s2.getUTCFullYear()}-${String(s2.getUTCMonth() + 1).padStart(2, "0")}-${String(s2.getUTCDate()).padStart(2, "0")}`;
    }
  }

  const { from, to } = rangeToUtc(fromYmd, toYmd);

  const days: string[] = [];
  {
    const cur = new Date(Date.UTC(
      Number(fromYmd.slice(0, 4)),
      Number(fromYmd.slice(5, 7)) - 1,
      Number(fromYmd.slice(8, 10))
    ));
    const end = new Date(Date.UTC(
      Number(toYmd.slice(0, 4)),
      Number(toYmd.slice(5, 7)) - 1,
      Number(toYmd.slice(8, 10))
    ));
    while (cur <= end && days.length < 30) {
      days.push(
        `${cur.getUTCFullYear()}-${String(cur.getUTCMonth() + 1).padStart(2, "0")}-${String(cur.getUTCDate()).padStart(2, "0")}`
      );
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
  }

  const users = await prisma.user.findMany({
    where: { profileComplete: true },
    orderBy: [{ regNo: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      nick: true,
      steamId: true,
      createdAt: true,
      regNo: true,
    },
  });

  const sessions = await prisma.squadServerSession.findMany({
    where: {
      joinedAt: { gte: from, lt: to },
      serverKey,
    },
    orderBy: { joinedAt: "asc" },
    select: {
      userId: true,
      steamId: true,
      joinedAt: true,
      leftAt: true,
      nickAtJoin: true,
      serverKey: true,
    },
  });

  type Cell = { in: string; out: string | null; mins: number };
  const byUserDay = new Map<string, Map<string, Cell[]>>();

  for (const s of sessions) {
    const day = ymdMsk(s.joinedAt);
    if (!days.includes(day)) continue;
    const end = s.leftAt ?? now;
    const mins = Math.max(
      0,
      Math.round((end.getTime() - s.joinedAt.getTime()) / 60000)
    );
    if (!byUserDay.has(s.userId)) byUserDay.set(s.userId, new Map());
    const m = byUserDay.get(s.userId)!;
    if (!m.has(day)) m.set(day, []);
    m.get(day)!.push({
      in: hmMsk(s.joinedAt),
      out: s.leftAt ? hmMsk(s.leftAt) : null,
      mins,
    });
  }

  const rows = users.map((u) => {
    const dayMap = byUserDay.get(u.id) || new Map();
    const cells: Record<string, Cell[]> = {};
    for (const d of days) cells[d] = dayMap.get(d) || [];
    return {
      regNo: u.regNo ?? 0,
      userId: u.id,
      nick: u.nick,
      steamId: u.steamId,
      cells,
    };
  });

  // stats
  let totalSessions = 0;
  let totalMinutes = 0;
  const leaveBucket: Record<string, number> = {
    "21": 0,
    "22": 0,
    "23": 0,
    "00": 0,
    "01": 0,
    other: 0,
  };
  const joinBucket: Record<string, number> = {
    before21: 0,
    "2130": 0,
    after2130: 0,
  };
  const weekday = [0, 0, 0, 0, 0, 0, 0];
  /**
   * TR1: уникальные игроки в окне 21:00–00:00 МСК (тренировка)
   * PB1: уникальные игроки за полные сутки (24ч) по дню захода
   */
  const playersPerDay: Record<string, Set<string>> = {};
  const isPublic = serverKey === "TPUB1";

  for (const s of sessions) {
    totalSessions += 1;
    const end = s.leftAt ?? now;
    totalMinutes += Math.max(
      0,
      Math.round((end.getTime() - s.joinedAt.getTime()) / 60000)
    );
    const jp = mskParts(s.joinedAt);
    const jmin = jp.h * 60 + jp.min;
    if (jmin <= 21 * 60) joinBucket.before21 += 1;
    else if (jmin <= 21 * 60 + 30) joinBucket["2130"] += 1;
    else joinBucket.after2130 += 1;

    if (s.leftAt) {
      const lp = mskParts(s.leftAt);
      const key =
        lp.h === 21
          ? "21"
          : lp.h === 22
            ? "22"
            : lp.h === 23
              ? "23"
              : lp.h === 0
                ? "00"
                : lp.h === 1
                  ? "01"
                  : "other";
      leaveBucket[key] = (leaveBucket[key] || 0) + 1;
    }

    const day = ymdMsk(s.joinedAt);
    const sessEnd = s.leftAt ?? now;
    let countsForDay = false;
    if (isPublic) {
      // Паблик: любые сессии за календарные сутки МСК
      countsForDay = true;
    } else {
      // TR1: пересечение с окном 21:00–00:00 МСК дня захода
      const winStart = new Date(
        Date.UTC(jp.y, jp.m - 1, jp.day, 21, 0, 0) - 3 * 3600 * 1000
      );
      const winEnd = new Date(
        Date.UTC(jp.y, jp.m - 1, jp.day + 1, 0, 0, 0) - 3 * 3600 * 1000
      );
      countsForDay =
        s.joinedAt.getTime() < winEnd.getTime() &&
        sessEnd.getTime() > winStart.getTime();
    }
    if (countsForDay) {
      if (!playersPerDay[day]) playersPerDay[day] = new Set();
      playersPerDay[day].add(s.userId);
    }

    const wi = (() => {
      const utcish = Date.UTC(jp.y, jp.m - 1, jp.day);
      const dow = new Date(utcish).getUTCDay();
      return dow === 0 ? 6 : dow - 1;
    })();
    weekday[wi] += 1;
  }

  const dayPlayerCounts = days.map((d) => ({
    day: d,
    players: playersPerDay[d]?.size || 0,
  }));
  const avgPlayers =
    dayPlayerCounts.length > 0
      ? Math.round(
          (10 *
            dayPlayerCounts.reduce((s, x) => s + x.players, 0)) /
            dayPlayerCounts.length
        ) / 10
      : 0;

  const windowLabel = isPublic ? "00:00–24:00 МСК" : "21:00–00:00 МСК";

  return NextResponse.json({
    from: fromYmd,
    to: toYmd,
    server: isPublic ? "PB1" : "TR1",
    days,
    rows,
    stats: {
      totalSessions,
      totalMinutes,
      avgSessionMin:
        totalSessions > 0 ? Math.round(totalMinutes / totalSessions) : 0,
      uniquePlayers: new Set(sessions.map((s) => s.userId)).size,
      leaveBucket,
      joinBucket,
      weekday,
      dayPlayerCounts,
      avgPlayersPerDay: avgPlayers,
      windowLabel,
      windowMode: isPublic ? "day" : "evening",
    },
  });
}
