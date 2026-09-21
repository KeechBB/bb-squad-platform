import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { RACE_RATING_START } from "@/lib/reaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let legacyRemapped = false;

/** Архив старого time-L2 → 12; бывшие очки L3 → L2 (идемпотентно) */
async function remapLegacyRunsOnce() {
  if (legacyRemapped) return;
  try {
    await prisma.$executeRawUnsafe(`
      UPDATE "ReactionRun"
      SET level = 12
      WHERE level = 2
        AND jsonb_typeof(attempts::jsonb) = 'array'
    `);
    await prisma.$executeRawUnsafe(`
      UPDATE "ReactionRun"
      SET level = 2
      WHERE level = 3
    `);
    legacyRemapped = true;
  } catch {
    /* ignore if json cast fails on empty */
  }
}

type Agg = {
  bestL1: number | null;
  runsL1: number;
  bestL2: number | null;
  runsL2: number;
  raceRating: number;
};

/** Рейтинг: L1 сек · L2 очки · Карт-дуэль Elo */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }

  await remapLegacyRunsOnce();

  const grouped = await prisma.reactionRun.groupBy({
    by: ["userId", "level"],
    _count: { _all: true },
    _min: { avgMs: true },
    _max: { avgMs: true },
    where: { level: { in: [1, 2] } },
  });

  const byUser = new Map<string, Agg>();
  for (const g of grouped) {
    const cur = byUser.get(g.userId) || {
      bestL1: null,
      runsL1: 0,
      bestL2: null,
      runsL2: 0,
      raceRating: RACE_RATING_START,
    };
    const count = g._count._all;
    if (g.level === 1) {
      cur.runsL1 = count;
      cur.bestL1 = g._min.avgMs;
    } else if (g.level === 2) {
      cur.runsL2 = count;
      cur.bestL2 = g._max.avgMs;
    }
    byUser.set(g.userId, cur);
  }

  const raceUsers = await prisma.user.findMany({
    where: {
      OR: [
        { id: { in: [...byUser.keys()] } },
        { raceRating: { not: RACE_RATING_START } },
        { raceRoomsHost: { some: {} } },
        { raceRoomsGuest: { some: {} } },
      ],
    },
    select: {
      id: true,
      nick: true,
      steamName: true,
      raceRating: true,
    },
  });

  for (const u of raceUsers) {
    const cur = byUser.get(u.id) || {
      bestL1: null,
      runsL1: 0,
      bestL2: null,
      runsL2: 0,
      raceRating: RACE_RATING_START,
    };
    cur.raceRating = u.raceRating;
    byUser.set(u.id, cur);
  }

  const nickById = new Map(
    raceUsers.map((u) => [u.id, u.nick || u.steamName || "Игрок"] as const)
  );
  // fill nicks for run-only users
  const missing = [...byUser.keys()].filter((id) => !nickById.has(id));
  if (missing.length) {
    const extra = await prisma.user.findMany({
      where: { id: { in: missing } },
      select: { id: true, nick: true, steamName: true, raceRating: true },
    });
    for (const u of extra) {
      nickById.set(u.id, u.nick || u.steamName || "Игрок");
      const cur = byUser.get(u.id);
      if (cur) cur.raceRating = u.raceRating;
    }
  }

  const rows = [...byUser.entries()]
    .map(([userId, a]) => ({
      userId,
      nick: nickById.get(userId) || "Игрок",
      bestL1: a.bestL1,
      runsL1: a.runsL1,
      bestL2: a.bestL2,
      runsL2: a.runsL2,
      raceRating: a.raceRating,
      bestL3: null as number | null,
      runsL3: 0,
    }))
    .filter(
      (r) =>
        r.bestL1 != null ||
        r.bestL2 != null ||
        r.raceRating !== RACE_RATING_START ||
        r.runsL1 > 0 ||
        r.runsL2 > 0
    )
    .sort((a, b) => {
      const a1 = a.bestL1 ?? Number.POSITIVE_INFINITY;
      const b1 = b.bestL1 ?? Number.POSITIVE_INFINITY;
      if (a1 !== b1) return a1 - b1;
      return String(a.nick).localeCompare(String(b.nick), "ru");
    });

  return NextResponse.json({ ok: true, rows });
}
