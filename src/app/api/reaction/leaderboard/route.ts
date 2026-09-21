import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Agg = {
  bestL1: number | null;
  runsL1: number;
  bestL2: number | null;
  runsL2: number;
  bestL3: number | null;
  runsL3: number;
};

/** Общий рейтинг тренировки стрельбы: рекорд + число серий по ур.1–3 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }

  const grouped = await prisma.reactionRun.groupBy({
    by: ["userId", "level"],
    _count: { _all: true },
    _min: { avgMs: true },
    _max: { avgMs: true },
  });

  if (!grouped.length) {
    return NextResponse.json({ ok: true, rows: [] });
  }

  const byUser = new Map<string, Agg>();
  for (const g of grouped) {
    const cur = byUser.get(g.userId) || {
      bestL1: null,
      runsL1: 0,
      bestL2: null,
      runsL2: 0,
      bestL3: null,
      runsL3: 0,
    };
    const count = g._count._all;
    if (g.level === 1) {
      cur.runsL1 = count;
      cur.bestL1 = g._min.avgMs;
    } else if (g.level === 2) {
      cur.runsL2 = count;
      cur.bestL2 = g._min.avgMs;
    } else if (g.level === 3) {
      cur.runsL3 = count;
      cur.bestL3 = g._max.avgMs;
    }
    byUser.set(g.userId, cur);
  }

  const users = await prisma.user.findMany({
    where: { id: { in: [...byUser.keys()] } },
    select: { id: true, nick: true, steamName: true },
  });
  const nickById = new Map(
    users.map((u) => [u.id, u.nick || u.steamName || "Игрок"] as const)
  );

  const rows = [...byUser.entries()]
    .map(([userId, a]) => ({
      userId,
      nick: nickById.get(userId) || "Игрок",
      bestL1: a.bestL1,
      runsL1: a.runsL1,
      bestL2: a.bestL2,
      runsL2: a.runsL2,
      bestL3: a.bestL3,
      runsL3: a.runsL3,
    }))
    .sort((a, b) => {
      const a1 = a.bestL1 ?? Number.POSITIVE_INFINITY;
      const b1 = b.bestL1 ?? Number.POSITIVE_INFINITY;
      if (a1 !== b1) return a1 - b1;
      return String(a.nick).localeCompare(String(b.nick), "ru");
    });

  return NextResponse.json({ ok: true, rows });
}
