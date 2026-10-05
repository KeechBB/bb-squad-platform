import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSiteVisitsAccess } from "@/lib/requireAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function todayMskStr(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function mskDayRange(dateStr: string): { from: Date; to: Date } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const from = new Date(`${dateStr}T00:00:00+03:00`);
  const to = new Date(`${dateStr}T24:00:00+03:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  return { from, to };
}

function mskDaysAgoRange(days: number): { from: Date; to: Date } {
  const today = todayMskStr();
  const end = mskDayRange(today)!;
  const startDay = new Date(`${today}T12:00:00+03:00`);
  startDay.setDate(startDay.getDate() - (days - 1));
  const startStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(startDay);
  const start = mskDayRange(startStr)!;
  return { from: start.from, to: end.to };
}

function hostOf(ref: string | null | undefined): string {
  if (!ref) return "(прямо / неизвестно)";
  try {
    return new URL(ref).hostname.replace(/^www\./, "");
  } catch {
    return ref.slice(0, 60);
  }
}

function dayKeyMsk(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * GET — только Keech.
 * Roster юзеров / лента / полная аналитика трафика (гости + регистрации).
 */
export async function GET(req: Request) {
  try {
    const gate = await requireSiteVisitsAccess();
    if (gate.error) return gate.error;

    const url = new URL(req.url);
    const userId = url.searchParams.get("userId")?.trim() || "";
    const nickQ = url.searchParams.get("nick")?.trim() || "";
    const date = url.searchParams.get("date")?.trim() || "";
    const before = url.searchParams.get("before")?.trim() || "";
    const periodDays = Math.min(
      90,
      Math.max(1, Number(url.searchParams.get("periodDays") || 7) || 7)
    );
    const limit = Math.min(
      5000,
      Math.max(1, Number(url.searchParams.get("limit") || 500) || 500)
    );

    const range = date ? mskDayRange(date) : null;
    if (date && !range) {
      return NextResponse.json(
        { error: "date должен быть YYYY-MM-DD" },
        { status: 400 }
      );
    }

    const createdAtFilter = range
      ? { gte: range.from, lt: range.to }
      : undefined;

    let targetId = userId;
    if (!targetId && nickQ) {
      const u = await prisma.user.findFirst({
        where: { nick: { equals: nickQ, mode: "insensitive" } },
        select: { id: true },
      });
      if (!u) {
        return NextResponse.json({ error: "Ник не найден" }, { status: 404 });
      }
      targetId = u.id;
    }

    if (!targetId) {
      return await rosterPayload(periodDays, date, createdAtFilter);
    }

    return await userFeedPayload(
      targetId,
      date,
      createdAtFilter,
      before,
      limit
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[admin/visits]", msg);
    return NextResponse.json(
      { error: "visits_failed", detail: msg.slice(0, 400) },
      { status: 500 }
    );
  }
}

function num(v: bigint | number | null | undefined): number {
  if (v == null) return 0;
  return typeof v === "bigint" ? Number(v) : v;
}

async function rosterPayload(
  periodDays: number,
  date: string,
  createdAtFilter: { gte: Date; lt: Date } | undefined
) {
  const todayRange = mskDayRange(todayMskStr())!;
  const period = mskDaysAgoRange(periodDays);

  // Один groupBy вместо N вложенных _count на каждого юзера
  const [users, visitCounts] = await Promise.all([
    prisma.user.findMany({
      where: { profileComplete: true },
      orderBy: [{ nick: "asc" }, { steamName: "asc" }],
      select: {
        id: true,
        nick: true,
        steamName: true,
        steamId: true,
      },
    }),
    prisma.sitePageVisit.groupBy({
      by: ["userId"],
      where: {
        userId: { not: null },
        ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
      },
      _count: { _all: true },
    }),
  ]);
  const visitsByUser = new Map(
    visitCounts
      .filter((r) => r.userId)
      .map((r) => [r.userId!, r._count._all])
  );

  type DayHitRow = {
    day: string;
    hits: bigint;
    auth_hits: bigint;
    people: bigint;
  };
  type HourRow = { hour: number; hits: bigint };
  type DayCountRow = { day: string; n: bigint };
  type PathCountRow = { path: string; c: bigint };
  type RefCountRow = { referrer: string | null; c: bigint };
  type LandingCountRow = { landingPath: string | null; c: bigint };

  const [
    todayVisits,
    todayPeopleRow,
    periodVisits,
    firstVisit,
    dailyHitsRows,
  ] = await Promise.all([
    prisma.sitePageVisit.count({
      where: { createdAt: { gte: todayRange.from, lt: todayRange.to } },
    }),
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(DISTINCT "userId")::bigint AS n
      FROM "SitePageVisit"
      WHERE "createdAt" >= ${todayRange.from}
        AND "createdAt" < ${todayRange.to}
        AND "userId" IS NOT NULL
    `,
    prisma.sitePageVisit.count({
      where: { createdAt: { gte: period.from, lt: period.to } },
    }),
    prisma.sitePageVisit.findFirst({
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    // Агрегация в SQL — раньше тянули ВСЕ строки периода в Node → 504
    prisma.$queryRaw<DayHitRow[]>`
      SELECT
        to_char(
          (("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow'),
          'YYYY-MM-DD'
        ) AS day,
        COUNT(*)::bigint AS hits,
        COUNT(*) FILTER (WHERE "userId" IS NOT NULL)::bigint AS auth_hits,
        COUNT(DISTINCT "userId") FILTER (WHERE "userId" IS NOT NULL)::bigint AS people
      FROM "SitePageVisit"
      WHERE "createdAt" >= ${period.from} AND "createdAt" < ${period.to}
      GROUP BY 1
      ORDER BY 1
    `,
  ]);

  const todayPeople = num(todayPeopleRow[0]?.n);
  const peopleSum = dailyHitsRows.reduce((s, r) => s + num(r.people), 0);
  const daysWithPeople = dailyHitsRows.filter((r) => num(r.people) > 0).length || 1;
  const avgPeoplePerDay = Math.round((peopleSum / daysWithPeople) * 10) / 10;
  const avgVisitsPerDay = Math.round((periodVisits / periodDays) * 10) / 10;

  let traffic: {
    uniqueAll: number;
    uniqueToday: number;
    uniquePeriod: number;
    linkedAll: number;
    linkedPeriod: number;
    registeredAll: number;
    registeredPeriod: number;
    conversionPct: number;
    sources: { source: string; count: number }[];
    landings: { path: string; count: number }[];
    paths: { path: string; count: number }[];
    daily: {
      day: string;
      newVisitors: number;
      hits: number;
      authHits: number;
    }[];
    hourly: { hour: number; hits: number }[];
    onlineNow: {
      id: string;
      nick: string | null;
      steamName: string | null;
      steamId: string;
      lastSeenAt: string | null;
    }[];
  } = {
    uniqueAll: 0,
    uniqueToday: 0,
    uniquePeriod: 0,
    linkedAll: 0,
    linkedPeriod: 0,
    registeredAll: 0,
    registeredPeriod: 0,
    conversionPct: 0,
    sources: [],
    landings: [],
    paths: [],
    daily: [],
    hourly: [],
    onlineNow: [],
  };

  try {
    const [
      visitorsAll,
      visitorsToday,
      visitorsPeriod,
      visitorsLinkedAll,
      visitorsLinkedPeriod,
      registeredAll,
      registeredPeriod,
      topReferrers,
      topLandings,
      topPaths,
      newVisitorsByDay,
      hourlyRows,
      onlineNow,
    ] = await Promise.all([
      prisma.siteVisitor.count(),
      prisma.siteVisitor.count({
        where: {
          OR: [
            { firstSeenAt: { gte: todayRange.from, lt: todayRange.to } },
            { lastSeenAt: { gte: todayRange.from, lt: todayRange.to } },
          ],
        },
      }),
      prisma.siteVisitor.count({
        where: {
          OR: [
            { firstSeenAt: { gte: period.from, lt: period.to } },
            { lastSeenAt: { gte: period.from, lt: period.to } },
          ],
        },
      }),
      prisma.siteVisitor.count({ where: { userId: { not: null } } }),
      prisma.siteVisitor.count({
        where: {
          userId: { not: null },
          firstSeenAt: { gte: period.from, lt: period.to },
        },
      }),
      prisma.user.count({ where: { profileComplete: true } }),
      prisma.user.count({
        where: {
          profileComplete: true,
          createdAt: { gte: period.from, lt: period.to },
        },
      }),
      prisma.$queryRaw<RefCountRow[]>`
        SELECT referrer, COUNT(*)::bigint AS c
        FROM "SiteVisitor"
        GROUP BY referrer
        ORDER BY c DESC
        LIMIT 80
      `,
      prisma.$queryRaw<LandingCountRow[]>`
        SELECT "landingPath", COUNT(*)::bigint AS c
        FROM "SiteVisitor"
        WHERE "landingPath" IS NOT NULL
        GROUP BY "landingPath"
        ORDER BY c DESC
        LIMIT 15
      `,
      prisma.$queryRaw<PathCountRow[]>`
        SELECT path, COUNT(*)::bigint AS c
        FROM "SitePageVisit"
        WHERE "createdAt" >= ${period.from} AND "createdAt" < ${period.to}
        GROUP BY path
        ORDER BY c DESC
        LIMIT 20
      `,
      prisma.$queryRaw<DayCountRow[]>`
        SELECT
          to_char(
            (("firstSeenAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow'),
            'YYYY-MM-DD'
          ) AS day,
          COUNT(*)::bigint AS n
        FROM "SiteVisitor"
        WHERE "firstSeenAt" >= ${period.from} AND "firstSeenAt" < ${period.to}
        GROUP BY 1
      `,
      prisma.$queryRaw<HourRow[]>`
        SELECT
          EXTRACT(
            HOUR FROM (("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow')
          )::int AS hour,
          COUNT(*)::bigint AS hits
        FROM "SitePageVisit"
        WHERE "createdAt" >= ${period.from} AND "createdAt" < ${period.to}
        GROUP BY 1
      `,
      prisma.user.findMany({
        where: {
          profileComplete: true,
          lastSeenAt: { gte: new Date(Date.now() - 3 * 60 * 1000) },
        },
        orderBy: { lastSeenAt: "desc" },
        take: 40,
        select: {
          id: true,
          nick: true,
          steamName: true,
          steamId: true,
          lastSeenAt: true,
        },
      }),
    ]);

    const refMap = new Map<string, number>();
    for (const r of topReferrers) {
      const host = hostOf(r.referrer);
      refMap.set(host, (refMap.get(host) || 0) + num(r.c));
    }
    const sources = [...refMap.entries()]
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);

    const landings = topLandings.map((x) => ({
      path: x.landingPath!,
      count: num(x.c),
    }));

    const paths = topPaths.map((x) => ({ path: x.path, count: num(x.c) }));

    const newByDay = new Map(
      newVisitorsByDay.map((r) => [r.day, num(r.n)])
    );
    const hitsByDay = new Map(dailyHitsRows.map((r) => [r.day, num(r.hits)]));
    const authHitsByDay = new Map(
      dailyHitsRows.map((r) => [r.day, num(r.auth_hits)])
    );

    const allDays = new Set([...newByDay.keys(), ...hitsByDay.keys()]);
    {
      const cursor = new Date(period.from.getTime() + 12 * 3600 * 1000);
      const end = period.to.getTime();
      while (cursor.getTime() < end) {
        allDays.add(dayKeyMsk(cursor));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    }
    const daily = [...allDays]
      .sort()
      .map((day) => ({
        day,
        newVisitors: newByDay.get(day) || 0,
        hits: hitsByDay.get(day) || 0,
        authHits: authHitsByDay.get(day) || 0,
      }));

    const hourHits = new Array(24).fill(0) as number[];
    for (const r of hourlyRows) {
      if (r.hour >= 0 && r.hour < 24) hourHits[r.hour] = num(r.hits);
    }
    const hourly = hourHits.map((hits, hour) => ({ hour, hits }));

    const conversionPct =
      visitorsAll > 0
        ? Math.round((1000 * visitorsLinkedAll) / visitorsAll) / 10
        : 0;

    traffic = {
      uniqueAll: visitorsAll,
      uniqueToday: visitorsToday,
      uniquePeriod: visitorsPeriod,
      linkedAll: visitorsLinkedAll,
      linkedPeriod: visitorsLinkedPeriod,
      registeredAll,
      registeredPeriod,
      conversionPct,
      sources,
      landings,
      paths,
      daily,
      hourly,
      onlineNow: onlineNow.map((u) => ({
        id: u.id,
        nick: u.nick,
        steamName: u.steamName,
        steamId: u.steamId,
        lastSeenAt: u.lastSeenAt?.toISOString() ?? null,
      })),
    };
  } catch (e) {
    console.error("[admin/visits] traffic block", e);
  }

  return NextResponse.json({
    mode: "roster",
    date: date || null,
    summary: {
      today: todayMskStr(),
      todayPeople,
      todayVisits,
      periodDays,
      periodVisits,
      avgPeoplePerDay,
      avgVisitsPerDay,
      logSince: firstVisit?.createdAt.toISOString() ?? null,
    },
    traffic,
    users: users.map((u) => ({
      id: u.id,
      nick: u.nick,
      steamName: u.steamName,
      steamId: u.steamId,
      visits: visitsByUser.get(u.id) || 0,
    })),
  });
}

async function userFeedPayload(
  targetId: string,
  date: string,
  createdAtFilter: { gte: Date; lt: Date } | undefined,
  before: string,
  limit: number
) {
  const user = await prisma.user.findUnique({
    where: { id: targetId },
    select: {
      id: true,
      nick: true,
      steamName: true,
      steamId: true,
    },
  });
  if (!user) {
    return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
  }

  const beforeDate = before ? new Date(before) : null;
  if (before && beforeDate && Number.isNaN(beforeDate.getTime())) {
    return NextResponse.json({ error: "bad before" }, { status: 400 });
  }

  const createdAtWhere: { gte?: Date; lt?: Date } = {};
  if (createdAtFilter) {
    createdAtWhere.gte = createdAtFilter.gte;
    createdAtWhere.lt = createdAtFilter.lt;
  }
  if (beforeDate) {
    if (!createdAtWhere.lt || beforeDate < createdAtWhere.lt) {
      createdAtWhere.lt = beforeDate;
    }
  }

  const listWhere = {
    userId: targetId,
    ...(Object.keys(createdAtWhere).length
      ? { createdAt: createdAtWhere }
      : {}),
  };
  const countWhere = {
    userId: targetId,
    ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
  };

  const [total, visits] = await Promise.all([
    prisma.sitePageVisit.count({ where: countWhere }),
    prisma.sitePageVisit.findMany({
      where: listWhere,
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        path: true,
        nickAt: true,
        referrer: true,
        createdAt: true,
      },
    }),
  ]);

  const byPath = new Map<string, number>();
  for (const v of visits) {
    byPath.set(v.path, (byPath.get(v.path) || 0) + 1);
  }

  return NextResponse.json({
    mode: "user",
    date: date || null,
    user,
    total,
    hasMore: visits.length === limit,
    nextBefore: visits.length
      ? visits[visits.length - 1].createdAt.toISOString()
      : null,
    byPath: [...byPath.entries()]
      .map(([path, count]) => ({ path, count }))
      .sort((a, b) => b.count - a.count),
    visits: visits.map((v) => ({
      id: v.id,
      path: v.path,
      nickAt: v.nickAt,
      referrer: v.referrer,
      createdAt: v.createdAt.toISOString(),
    })),
  });
}
