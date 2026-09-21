import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  REACTION_PRESENCE_MS,
  isScoreLevel,
  normalizeLevel,
  type ReactionLevel,
} from "@/lib/reaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  if (!best) return null;
  return {
    avgMs: best.avgMs,
    userId: best.userId,
    nick: best.user.nick || best.user.steamName || "Игрок",
  };
}

/** Heartbeat: я на вкладке тренировки */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { steamId: session.user.steamId },
    select: { id: true },
  });
  if (!user) return NextResponse.json({ ok: false }, { status: 404 });

  let lastAvgMs: number | null | undefined;
  let lastAvgL1Ms: number | null | undefined;
  let lastAvgL2Ms: number | null | undefined;
  let lastAvgL3Ms: number | null | undefined;
  try {
    const body = await req.json().catch(() => ({}));
    if (body && typeof body.lastAvgMs === "number" && Number.isFinite(body.lastAvgMs)) {
      lastAvgMs = body.lastAvgMs;
    }
    if (body && typeof body.lastAvgL1Ms === "number" && Number.isFinite(body.lastAvgL1Ms)) {
      lastAvgL1Ms = body.lastAvgL1Ms;
    }
    if (body && typeof body.lastAvgL2Ms === "number" && Number.isFinite(body.lastAvgL2Ms)) {
      lastAvgL2Ms = body.lastAvgL2Ms;
    }
    if (body && typeof body.lastAvgL3Ms === "number" && Number.isFinite(body.lastAvgL3Ms)) {
      lastAvgL3Ms = body.lastAvgL3Ms;
    }
    if (
      body &&
      typeof body.lastAvgMs === "number" &&
      Number.isFinite(body.lastAvgMs) &&
      body.level != null
    ) {
      const lv = normalizeLevel(body.level);
      if (lv === 1) lastAvgL1Ms = body.lastAvgMs;
      else if (lv === 2) lastAvgL2Ms = body.lastAvgMs;
      else lastAvgL3Ms = body.lastAvgMs;
    }
  } catch {
    /* ignore */
  }

  await prisma.reactionPresence.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      lastAvgMs: lastAvgMs ?? null,
      lastAvgL1Ms: lastAvgL1Ms ?? null,
      lastAvgL2Ms: lastAvgL2Ms ?? null,
      lastAvgL3Ms: lastAvgL3Ms ?? null,
    },
    update: {
      ...(lastAvgMs !== undefined ? { lastAvgMs } : {}),
      ...(lastAvgL1Ms !== undefined ? { lastAvgL1Ms } : {}),
      ...(lastAvgL2Ms !== undefined ? { lastAvgL2Ms } : {}),
      ...(lastAvgL3Ms !== undefined ? { lastAvgL3Ms } : {}),
      updatedAt: new Date(),
    },
  });

  return NextResponse.json({ ok: true });
}

/** Кто сейчас на вкладке + глобальные рекорды ур.1 / ур.2 / ур.3 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const since = new Date(Date.now() - REACTION_PRESENCE_MS);
  const [rows, recordL1, recordL2, recordL3] = await Promise.all([
    prisma.reactionPresence.findMany({
      where: { updatedAt: { gte: since } },
      orderBy: [{ updatedAt: "desc" }],
      include: {
        user: {
          select: {
            id: true,
            nick: true,
            avatarUrl: true,
            steamName: true,
          },
        },
      },
    }),
    globalRecord(1),
    globalRecord(2),
    globalRecord(3),
  ]);

  const players = rows
    .map((r) => ({
      userId: r.userId,
      nick: r.user.nick || r.user.steamName || "Игрок",
      avatarUrl: r.user.avatarUrl,
      lastAvgMs: r.lastAvgMs,
      lastAvgL1Ms: r.lastAvgL1Ms,
      lastAvgL2Ms: r.lastAvgL2Ms,
      lastAvgL3Ms: r.lastAvgL3Ms,
      updatedAt: r.updatedAt.toISOString(),
    }))
    .sort((a, b) => {
      const best = (p: {
        lastAvgL1Ms: number | null;
        lastAvgL2Ms: number | null;
      }) => {
        const vals = [p.lastAvgL1Ms, p.lastAvgL2Ms].filter(
          (v): v is number => v != null && Number.isFinite(v)
        );
        return vals.length ? Math.min(...vals) : null;
      };
      const av = best(a);
      const bv = best(b);
      if (av == null && bv == null) {
        return String(a.nick).localeCompare(String(b.nick), "ru");
      }
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av !== bv) return av - bv;
      return String(a.nick).localeCompare(String(b.nick), "ru");
    });

  return NextResponse.json({
    ok: true,
    players,
    records: {
      l1: recordL1,
      l2: recordL2,
      l3: recordL3,
    },
  });
}
