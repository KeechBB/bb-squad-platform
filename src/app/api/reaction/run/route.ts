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
    create: { userId: user.id, lastAvgMs: avgMs },
    update: { lastAvgMs: avgMs, updatedAt: new Date() },
  });

  const best = await prisma.reactionRun.findFirst({
    where: { userId: user.id, level },
    orderBy: { avgMs: "asc" },
    select: { avgMs: true },
  });

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
