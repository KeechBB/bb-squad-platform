import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireKeechOnly } from "@/lib/requireAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** МСК-сутки → UTC-границы для фильтра по дате YYYY-MM-DD */
function mskDayRange(dateStr: string): { from: Date; to: Date } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const from = new Date(`${dateStr}T00:00:00+03:00`);
  const to = new Date(`${dateStr}T24:00:00+03:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  return { from, to };
}

/**
 * GET — только Keech.
 * ?userId= | ?nick=  + опционально ?date=YYYY-MM-DD (МСК)
 * Без userId/nick — список зарегистрированных с кол-вом заходов за период.
 */
export async function GET(req: Request) {
  const gate = await requireKeechOnly();
  if (gate.error) return gate.error;

  const url = new URL(req.url);
  const userId = url.searchParams.get("userId")?.trim() || "";
  const nickQ = url.searchParams.get("nick")?.trim() || "";
  const date = url.searchParams.get("date")?.trim() || "";
  const limit = Math.min(
    500,
    Math.max(1, Number(url.searchParams.get("limit") || 200) || 200)
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
    return NextResponse.json({
      mode: "roster",
      date: date || null,
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

  const visits = await prisma.sitePageVisit.findMany({
    where: {
      userId: targetId,
      ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      path: true,
      nickAt: true,
      createdAt: true,
    },
  });

  const byPath = new Map<string, number>();
  for (const v of visits) {
    byPath.set(v.path, (byPath.get(v.path) || 0) + 1);
  }

  return NextResponse.json({
    mode: "user",
    date: date || null,
    user,
    total: visits.length,
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
