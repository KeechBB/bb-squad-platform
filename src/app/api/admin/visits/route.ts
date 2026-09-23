import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireKeechOnly } from "@/lib/requireAdmin";

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

/**
 * GET — только Keech.
 * Roster юзеров / лента / полная аналитика трафика (гости + регистрации).
 */
export async function GET(req: Request) {
  const gate = await requireKeechOnly();
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
    const todayRange = mskDayRange(todayMskStr())!;
    const period = mskDaysAgoRange(periodDays);

    const [
      users,
      todayVisits,
      todayPeopleRegistered,
      periodVisits,
      periodPeopleRows,
      firstVisit,
      // traffic uniques
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
      dailyVisitors,
    ] = await Promise.all([
      prisma.user.findMany({
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
      }),
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
      prisma.$queryRaw<{ d: Date; u: bigint }[]>`
        SELECT (timezone('Europe/Moscow', "createdAt"))::date AS d,
               COUNT(DISTINCT "userId")::bigint AS u
        FROM "SitePageVisit"
        WHERE "createdAt" >= ${period.from} AND "createdAt" < ${period.to}
          AND "userId" IS NOT NULL
        GROUP BY 1
      `,
      prisma.sitePageVisit.findFirst({
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }),
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
        orderBy: { _count: { referrer: "desc" } },
        take: 15,
      }),
      prisma.siteVisitor.groupBy({
        by: ["landingPath"],
        _count: { _all: true },
        orderBy: { _count: { landingPath: "desc" } },
        take: 15,
      }),
      prisma.sitePageVisit.groupBy({
        by: ["path"],
        where: { createdAt: { gte: period.from, lt: period.to } },
        _count: { _all: true },
        orderBy: { _count: { path: "desc" } },
        take: 15,
      }),
      prisma.$queryRaw<{ d: Date; visitors: bigint; hits: bigint }[]>`
        SELECT (timezone('Europe/Moscow', v."firstSeenAt"))::date AS d,
               COUNT(*)::bigint AS visitors,
               COALESCE((
                 SELECT COUNT(*)::bigint FROM "SitePageVisit" p
                 WHERE (timezone('Europe/Moscow', p."createdAt"))::date
                       = (timezone('Europe/Moscow', v."firstSeenAt"))::date
               ), 0) AS hits
        FROM "SiteVisitor" v
        WHERE v."firstSeenAt" >= ${period.from} AND v."firstSeenAt" < ${period.to}
        GROUP BY 1
        ORDER BY 1 ASC
      `,
    ]);

    const daysWithData = periodPeopleRows.length || 1;
    const avgPeoplePerDay =
      Math.round(
        (periodPeopleRows.reduce((s, r) => s + Number(r.u), 0) / daysWithData) *
          10
      ) / 10;
    const avgVisitsPerDay =
      Math.round((periodVisits / periodDays) * 10) / 10;

    const refMap = new Map<string, number>();
    for (const r of topReferrers) {
      const host = hostOf(r.referrer);
      refMap.set(host, (refMap.get(host) || 0) + r._count._all);
    }
    const sources = [...refMap.entries()]
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);

    const conversionAll =
      visitorsAll > 0
        ? Math.round((1000 * visitorsLinkedAll) / visitorsAll) / 10
        : 0;

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
      traffic: {
        uniqueAll: visitorsAll,
        uniqueToday: visitorsToday,
        uniquePeriod: visitorsPeriod,
        linkedAll: visitorsLinkedAll,
        linkedPeriod: visitorsLinkedPeriod,
        registeredAll,
        registeredPeriod,
        conversionPct: conversionAll,
        sources,
        landings: topLandings
          .filter((x) => x.landingPath)
          .map((x) => ({ path: x.landingPath!, count: x._count._all })),
        paths: topPaths.map((x) => ({
          path: x.path,
          count: x._count._all,
        })),
        daily: dailyVisitors.map((d) => ({
          day: d.d instanceof Date ? d.d.toISOString().slice(0, 10) : String(d.d),
          newVisitors: Number(d.visitors),
          hits: Number(d.hits),
        })),
      },
      users: users.map((u) => ({
        id: u.id,
        nick: u.nick,
        steamName: u.steamName,
        steamId: u.steamId,
        visits: u._count.pageVisits,
      })),
    });
  }

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
