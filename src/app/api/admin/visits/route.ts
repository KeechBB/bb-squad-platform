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

async function rosterPayload(
  periodDays: number,
  date: string,
  createdAtFilter: { gte: Date; lt: Date } | undefined
) {
  const todayRange = mskDayRange(todayMskStr())!;
  const period = mskDaysAgoRange(periodDays);

  const users = await prisma.user.findMany({
    where: { profileComplete: true },
    orderBy: [{ nick: "asc" }, { steamName: "asc" }],
    select: {
      id: true,
      nick: true,
      steamName: true,
      steamId: true,
      _count: {
        select: {
          pageVisits: createdAtFilter
            ? { where: { createdAt: createdAtFilter } }
            : true,
        },
      },
    },
  });

  const [todayVisits, todayPeopleRegistered, periodVisits, firstVisit] =
    await Promise.all([
      prisma.sitePageVisit.count({
        where: { createdAt: { gte: todayRange.from, lt: todayRange.to } },
      }),
      prisma.sitePageVisit.findMany({
        where: {
          createdAt: { gte: todayRange.from, lt: todayRange.to },
          userId: { not: null },
        },
        distinct: ["userId"],
        select: { userId: true },
      }),
      prisma.sitePageVisit.count({
        where: { createdAt: { gte: period.from, lt: period.to } },
      }),
      prisma.sitePageVisit.findFirst({
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }),
    ]);

  // People-per-day from page visits (registered only) — Prisma, no raw SQL
  const periodAuthVisits = await prisma.sitePageVisit.findMany({
    where: {
      createdAt: { gte: period.from, lt: period.to },
      userId: { not: null },
    },
    select: { userId: true, createdAt: true },
  });
  const dayPeople = new Map<string, Set<string>>();
  for (const v of periodAuthVisits) {
    if (!v.userId) continue;
    const k = dayKeyMsk(v.createdAt);
    let set = dayPeople.get(k);
    if (!set) {
      set = new Set();
      dayPeople.set(k, set);
    }
    set.add(v.userId);
  }
  const daysWithData = dayPeople.size || 1;
  const avgPeoplePerDay =
    Math.round(
      ([...dayPeople.values()].reduce((s, set) => s + set.size, 0) /
        daysWithData) *
        10
    ) / 10;
  const avgVisitsPerDay = Math.round((periodVisits / periodDays) * 10) / 10;

  // Traffic block — soft-fail if SiteVisitor missing / groupBy quirks
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
      newVisitorsPeriod,
      hitsByDayRows,
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
      prisma.siteVisitor.groupBy({
        by: ["referrer"],
        _count: { _all: true },
      }),
      prisma.siteVisitor.groupBy({
        by: ["landingPath"],
        _count: { _all: true },
      }),
      prisma.sitePageVisit.groupBy({
        by: ["path"],
        where: { createdAt: { gte: period.from, lt: period.to } },
        _count: { _all: true },
      }),
      prisma.siteVisitor.findMany({
        where: {
          firstSeenAt: { gte: period.from, lt: period.to },
        },
        select: { firstSeenAt: true },
      }),
      prisma.sitePageVisit.findMany({
        where: { createdAt: { gte: period.from, lt: period.to } },
        select: { createdAt: true, userId: true },
      }),
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

    const countAll = (c: { _count?: { _all?: number } | true }) =>
      typeof c._count === "object" && c._count && typeof c._count._all === "number"
        ? c._count._all
        : 0;

    const refMap = new Map<string, number>();
    for (const r of topReferrers) {
      const host = hostOf(r.referrer);
      refMap.set(host, (refMap.get(host) || 0) + countAll(r));
    }
    const sources = [...refMap.entries()]
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);

    const landings = topLandings
      .filter((x) => x.landingPath)
      .map((x) => ({ path: x.landingPath!, count: countAll(x) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);

    const paths = topPaths
      .map((x) => ({ path: x.path, count: countAll(x) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    const newByDay = new Map<string, number>();
    for (const v of newVisitorsPeriod) {
      const k = dayKeyMsk(v.firstSeenAt);
      newByDay.set(k, (newByDay.get(k) || 0) + 1);
    }
    const hitsByDay = new Map<string, number>();
    const authHitsByDay = new Map<string, number>();
    const hourHits = new Array(24).fill(0) as number[];
    for (const v of hitsByDayRows) {
      const k = dayKeyMsk(v.createdAt);
      hitsByDay.set(k, (hitsByDay.get(k) || 0) + 1);
      if (v.userId) {
        authHitsByDay.set(k, (authHitsByDay.get(k) || 0) + 1);
      }
      const hour = Number(
        new Intl.DateTimeFormat("en-GB", {
          timeZone: "Europe/Moscow",
          hour: "2-digit",
          hourCycle: "h23",
        }).format(v.createdAt)
      );
      if (Number.isFinite(hour) && hour >= 0 && hour < 24) {
        hourHits[hour] += 1;
      }
    }
    const allDays = new Set([...newByDay.keys(), ...hitsByDay.keys()]);
    // заполняем пустые дни периода, чтобы шкала была непрерывной
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
      todayPeople: todayPeopleRegistered.length,
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
      visits: u._count.pageVisits,
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
