import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  averageMs,
  normalizeLevel,
  validateAttempts,
} from "@/lib/reaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Сохранить серию из 10 попыток */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { steamId: session.user.steamId },
    select: { id: true },
  });
  if (!user) {
    return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const attempts = validateAttempts(body?.attempts);
  if (!attempts) {
    return NextResponse.json(
      { error: "Нужны 10 корректных попыток" },
      { status: 400 }
    );
  }

  const avgMs = averageMs(attempts);
  const level = normalizeLevel(body?.level);

  const run = await prisma.reactionRun.create({
    data: {
      userId: user.id,
      level,
      avgMs,
      attempts,
    },
  });

  await prisma.reactionPresence.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      lastAvgMs: avgMs,
      ...(level === 1 ? { lastAvgL1Ms: avgMs } : { lastAvgL2Ms: avgMs }),
    },
    update: {
      lastAvgMs: avgMs,
      ...(level === 1 ? { lastAvgL1Ms: avgMs } : { lastAvgL2Ms: avgMs }),
      updatedAt: new Date(),
    },
  });

  const [best, recordL1, recordL2] = await Promise.all([
    prisma.reactionRun.findFirst({
      where: { userId: user.id, level },
      orderBy: { avgMs: "asc" },
      select: { avgMs: true },
    }),
    prisma.reactionRun.findFirst({
      where: { level: 1 },
      orderBy: { avgMs: "asc" },
      select: {
        avgMs: true,
        userId: true,
        user: { select: { nick: true, steamName: true } },
      },
    }),
    prisma.reactionRun.findFirst({
      where: { level: 2 },
      orderBy: { avgMs: "asc" },
      select: {
        avgMs: true,
        userId: true,
        user: { select: { nick: true, steamName: true } },
      },
    }),
  ]);

  const mapRec = (
    r: {
      avgMs: number;
      userId: string;
      user: { nick: string | null; steamName: string | null };
    } | null
  ) =>
    r
      ? {
          avgMs: r.avgMs,
          userId: r.userId,
          nick: r.user.nick || r.user.steamName || "Игрок",
        }
      : null;

  return NextResponse.json({
    ok: true,
    run: {
      id: run.id,
      level: run.level,
      avgMs: run.avgMs,
      attempts: run.attempts,
      createdAt: run.createdAt.toISOString(),
    },
    bestAvgMs: best?.avgMs ?? avgMs,
    records: {
      l1: mapRec(recordL1),
      l2: mapRec(recordL2),
    },
  });
}

/** История текущего пользователя */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { steamId: session.user.steamId },
    select: { id: true },
  });
  if (!user) {
    return NextResponse.json({ error: "Не найден" }, { status: 404 });
  }

  const url = new URL(req.url);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 20));
  const levelParam = url.searchParams.get("level");
  const levelFilter =
    levelParam == null || levelParam === ""
      ? undefined
      : normalizeLevel(levelParam);

  const where = {
    userId: user.id,
    ...(levelFilter != null ? { level: levelFilter } : {}),
  };

  const [runs, best] = await Promise.all([
    prisma.reactionRun.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, avgMs: true, level: true, createdAt: true },
    }),
    prisma.reactionRun.findFirst({
      where,
      orderBy: { avgMs: "asc" },
      select: { avgMs: true, level: true, createdAt: true },
    }),
  ]);

  return NextResponse.json({
    ok: true,
    bestAvgMs: best?.avgMs ?? null,
    bestLevel: best?.level ?? null,
    bestAt: best?.createdAt?.toISOString() ?? null,
    history: runs.map((r) => ({
      id: r.id,
      avgMs: r.avgMs,
      level: r.level,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}
