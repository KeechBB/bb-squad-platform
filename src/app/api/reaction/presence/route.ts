import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { REACTION_PRESENCE_MS } from "@/lib/reaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  try {
    const body = await req.json().catch(() => ({}));
    if (body && typeof body.lastAvgMs === "number" && Number.isFinite(body.lastAvgMs)) {
      lastAvgMs = body.lastAvgMs;
    }
  } catch {
    /* ignore */
  }

  await prisma.reactionPresence.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      lastAvgMs: lastAvgMs ?? null,
    },
    update: {
      ...(lastAvgMs !== undefined ? { lastAvgMs } : {}),
      updatedAt: new Date(),
    },
  });

  return NextResponse.json({ ok: true });
}

/** Кто сейчас на вкладке */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const since = new Date(Date.now() - REACTION_PRESENCE_MS);
  const rows = await prisma.reactionPresence.findMany({
    where: { updatedAt: { gte: since } },
    orderBy: [{ lastAvgMs: "asc" }, { updatedAt: "desc" }],
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
  });

  return NextResponse.json({
    ok: true,
    players: rows.map((r) => ({
      userId: r.userId,
      nick: r.user.nick || r.user.steamName || "Игрок",
      avatarUrl: r.user.avatarUrl,
      lastAvgMs: r.lastAvgMs,
      updatedAt: r.updatedAt.toISOString(),
    })),
  });
}
