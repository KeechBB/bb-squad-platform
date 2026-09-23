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

/** МСК-сутки → UTC-границы для фильтра по дате YYYY-MM-DD */
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

/**
 * GET — только Keech.
 * ?userId= | ?nick=  + опционально ?date=YYYY-MM-DD (МСК)
 * ?limit= (до 5000) ?before=ISO — пагинация ленты
 * Без userId — roster + сводка (сегодня / среднее за periodDays)
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
      todayPeople,
      periodVisits,
      periodPeopleRows,
      firstVisit,
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
        where: { createdAt: { gte: todayRange.from, lt: todayRange.to } },
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
        GROUP BY 1
      `,
      prisma.sitePageVisit.findFirst({
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }),
    ]);

    const daysWithData = periodPeopleRows.length || 1;
    const avgPeoplePerDay =
      Math.round(
        (periodPeopleRows.reduce((s, r) => s + Number(r.u), 0) / daysWithData) *
          10
      ) / 10;
    const avgVisitsPerDay =
      Math.round((periodVisits / periodDays) * 10) / 10;

    return NextResponse.json({
      mode: "roster",
      date: date || null,
      summary: {
        today: todayMskStr(),
        todayPeople: todayPeople.length,
        todayVisits,
        periodDays,
        periodVisits,
        avgPeoplePerDay,
        avgVisitsPerDay,
        logSince: firstVisit?.createdAt.toISOString() ?? null,
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
      createdAt: v.createdAt.toISOString(),
    })),
  });
}
