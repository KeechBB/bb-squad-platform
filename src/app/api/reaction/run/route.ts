import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  averageMs,
  isScoreLevel,
  normalizeLevel,
  validateAttempts,
  validateL2Score,
  type ReactionLevel,
} from "@/lib/reaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RecRow = {
  avgMs: number;
  userId: string;
  user: { nick: string | null; steamName: string | null };
} | null;

function mapRec(r: RecRow) {
  return r
    ? {
        avgMs: r.avgMs,
        userId: r.userId,
        nick: r.user.nick || r.user.steamName || "Игрок",
      }
    : null;
}

async function bestForLevel(userId: string, level: ReactionLevel) {
  if (level === 3) return null;
  return prisma.reactionRun.findFirst({
    where: { userId, level },
    orderBy: { avgMs: isScoreLevel(level) ? "desc" : "asc" },
    select: { avgMs: true },
  });
}

async function globalRecord(level: ReactionLevel) {
  if (level === 3) return null;
  const best = await prisma.reactionRun.findFirst({
    where: { level },
    orderBy: { avgMs: isScoreLevel(level) ? "desc" : "asc" },
    select: {
      avgMs: true,
      userId: true,
      user: { select: { nick: true, steamName: true } },
    },
  });
  return mapRec(best);
}

function presencePatch(level: ReactionLevel, value: number) {
  if (level === 1) return { lastAvgL1Ms: value };
  if (level === 2) return { lastAvgL2Ms: value };
  return { lastAvgL3Ms: value };
}

/** Сохранить серию ур.1 или счёт ур.2 (шарики). Ур.3 — только Elo через race API. */
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
  let level = normalizeLevel(body?.level);
  // клиенты могли ещё слать level:3 для шариков — принимаем как ур.2
  if (level === 3 && body && typeof body === "object" && "score" in body) {
    level = 2;
  }
  if (level === 3) {
    return NextResponse.json(
      { error: "Карт-дуэль сохраняется через матч, не через /run" },
      { status: 400 }
    );
  }

  let avgMs: number;
  let attemptsPayload: unknown;

  if (level === 2) {
    const parsed = validateL2Score(body);
    if (!parsed) {
      return NextResponse.json(
        { error: "Нужен корректный счёт ур.2" },
        { status: 400 }
      );
    }
    avgMs = parsed.score;
    attemptsPayload = {
      hits: parsed.hits,
      misses: parsed.misses,
      score: parsed.score,
    };
  } else {
    const attempts = validateAttempts(body?.attempts);
    if (!attempts) {
      return NextResponse.json(
        { error: "Нужны 10 корректных попыток" },
        { status: 400 }
      );
    }
    avgMs = averageMs(attempts);
    attemptsPayload = attempts;
  }

  const run = await prisma.reactionRun.create({
    data: {
      userId: user.id,
      level,
      avgMs,
      attempts: attemptsPayload as object,
    },
  });

  const levelPatch = presencePatch(level, avgMs);
  await prisma.reactionPresence.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      lastAvgMs: avgMs,
      ...levelPatch,
    },
    update: {
      lastAvgMs: avgMs,
      ...levelPatch,
      updatedAt: new Date(),
    },
  });

  const [best, recordL1, recordL2] = await Promise.all([
    bestForLevel(user.id, level),
    globalRecord(1),
    globalRecord(2),
  ]);

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
      l1: recordL1,
      l2: recordL2,
      l3: null,
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
    select: { id: true, raceRating: true },
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

  if (levelFilter === 3) {
    return NextResponse.json({
      ok: true,
      bestAvgMs: user.raceRating,
      bestLevel: 3,
      bestAt: null,
      history: [],
      raceRating: user.raceRating,
    });
  }

  const where = {
    userId: user.id,
    ...(levelFilter != null ? { level: levelFilter } : { level: { in: [1, 2] } }),
  };

  const orderBest =
    levelFilter != null && isScoreLevel(levelFilter) ? ("desc" as const) : ("asc" as const);

  const [runs, best] = await Promise.all([
    prisma.reactionRun.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, avgMs: true, level: true, createdAt: true },
    }),
    prisma.reactionRun.findFirst({
      where,
      orderBy: { avgMs: orderBest },
      select: { avgMs: true, level: true, createdAt: true },
    }),
  ]);

  return NextResponse.json({
    ok: true,
    bestAvgMs: best?.avgMs ?? null,
    bestLevel: best?.level ?? null,
    bestAt: best?.createdAt?.toISOString() ?? null,
    raceRating: user.raceRating,
    history: runs.map((r) => ({
      id: r.id,
      avgMs: r.avgMs,
      level: r.level,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}
