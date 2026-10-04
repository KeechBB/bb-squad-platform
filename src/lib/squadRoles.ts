import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { mskDayBoundsUtc, formatMskYmd } from "@/lib/squadHits";
import {
  kitCountsToPct,
  kitFromDeployRole,
  canonKitName,
  type KitPctRow,
  type StandardKit,
} from "@/lib/squadKits";
import { normalizeEosId, normalizeSteamId } from "@/lib/squadSessions";

export type SquadRoleIngestEvent = {
  type: "role";
  steamId?: string | null;
  eosId?: string | null;
  nick?: string | null;
  role: string;
  /** ISO-8601 UTC */
  at: string;
  serverKey?: string;
};

export type KitsLane = "TR1" | "PB1";

export type KitsForUserOpts = {
  /** Один день МСК YYYY-MM-DD */
  dayYmd?: string | null;
  /** Интервал МСК включительно: from..to */
  fromYmd?: string | null;
  toYmd?: string | null;
  /** TR1 (+TR2) с боевым окном; PB1 — весь день без окна */
  lane?: KitsLane;
};

export function serverKeysForKitsLane(lane: KitsLane): string[] {
  if (lane === "PB1") return ["TPUB1", "PB1", "PUB"];
  return ["TR1", "TR2"];
}

/**
 * Боевое окно учёта ролей (МСК): 21:30 ≤ t < 01:00.
 * Разминка/брифинг до 21:30 и «после катки» с 01:00 не считаем.
 */
export const ROLE_COMBAT_START_MIN = 21 * 60 + 30;
export const ROLE_COMBAT_END_MIN = 1 * 60 + 0;

/** SQL-фрагмент: spawnedAt в боевом окне МСК. */
export const ROLE_COMBAT_MSK_SQL = `(
  (("spawnedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow')::time >= TIME '21:30:00'
  OR (("spawnedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow')::time < TIME '01:00:00'
)`;

/** true, если момент в [21:30, 01:00) Europe/Moscow. */
export function isRoleCombatWindowMsk(at: Date): boolean {
  if (Number.isNaN(at.getTime())) return false;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const h = Number(parts.find((p) => p.type === "hour")?.value);
  const m = Number(parts.find((p) => p.type === "minute")?.value);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return false;
  const mins = h * 60 + m;
  return mins >= ROLE_COMBAT_START_MIN || mins < ROLE_COMBAT_END_MIN;
}

export function roleEventKey(opts: {
  serverKey: string;
  spawnedAt: Date;
  userKey: string;
  roleRaw: string;
}): string {
  return [
    opts.serverKey,
    opts.spawnedAt.getTime(),
    opts.userKey,
    opts.roleRaw,
  ].join("|");
}

/** Границы интервала МСК [from..to] включительно → UTC [gte, lt). */
export function mskRangeBoundsUtc(
  fromYmd: string,
  toYmd: string
): { gte: Date; lt: Date } | null {
  const a = mskDayBoundsUtc(fromYmd);
  const b = mskDayBoundsUtc(toYmd);
  if (!a || !b) return null;
  if (a.gte.getTime() > b.gte.getTime()) {
    return { gte: b.gte, lt: a.lt };
  }
  return { gte: a.gte, lt: b.lt };
}

function spawnedAtFilter(opts: KitsForUserOpts):
  | { gte: Date; lt: Date }
  | undefined {
  const day = opts.dayYmd?.trim() || null;
  if (day) {
    const b = mskDayBoundsUtc(day);
    return b || undefined;
  }
  const from = opts.fromYmd?.trim() || null;
  const to = opts.toYmd?.trim() || null;
  if (from && to) {
    const b = mskRangeBoundsUtc(from, to);
    return b || undefined;
  }
  if (from) {
    const b = mskDayBoundsUtc(from);
    if (!b) return undefined;
    return { gte: b.gte, lt: new Date("9999-12-31T00:00:00.000Z") };
  }
  if (to) {
    const b = mskDayBoundsUtc(to);
    if (!b) return undefined;
    return { gte: new Date(0), lt: b.lt };
  }
  return undefined;
}

export async function kitsForUser(
  userId: string,
  opts: KitsForUserOpts = {}
): Promise<{ kits: KitPctRow[]; total: number }> {
  const range = spawnedAtFilter(opts);
  const lane: KitsLane = opts.lane === "PB1" ? "PB1" : "TR1";
  const keys = serverKeysForKitsLane(lane);
  const combatSql =
    lane === "TR1"
      ? Prisma.sql`AND (
          (("spawnedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow')::time >= TIME '21:30:00'
          OR (("spawnedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow')::time < TIME '01:00:00'
        )`
      : Prisma.empty;
  const rangeSql = range
    ? Prisma.sql`AND "spawnedAt" >= ${range.gte} AND "spawnedAt" < ${range.lt}`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<{ kit: string; n: bigint }[]>`
    SELECT kit, COUNT(*)::bigint AS n
    FROM "SquadRoleEvent"
    WHERE "userId" = ${userId}
      AND "serverKey" IN (${Prisma.join(keys)})
      ${rangeSql}
      ${combatSql}
    GROUP BY kit
  `;
  const counts: Partial<Record<string, number>> = {};
  let total = 0;
  for (const r of rows) {
    const n = Number(r.n) || 0;
    if (n <= 0) continue;
    const kit = canonKitName(r.kit);
    counts[kit] = (counts[kit] || 0) + n;
    total += n;
  }
  return { kits: kitCountsToPct(counts), total };
}

/** Дни МСК со спавнами ролей (календарь). TR1 — боевое окно; PB1 — весь день. */
export async function kitDaysForUser(
  userId: string,
  lane: KitsLane = "TR1"
): Promise<string[]> {
  const keys = serverKeysForKitsLane(lane);
  const combatSql =
    lane === "TR1"
      ? Prisma.sql`AND (
          (("spawnedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow')::time >= TIME '21:30:00'
          OR (("spawnedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow')::time < TIME '01:00:00'
        )`
      : Prisma.empty;
  const rows = await prisma.$queryRaw<{ d: Date }[]>`
    SELECT DISTINCT (
      (("spawnedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow')::date
    ) AS d
    FROM "SquadRoleEvent"
    WHERE "userId" = ${userId}
      AND "serverKey" IN (${Prisma.join(keys)})
      ${combatSql}
    ORDER BY d DESC
  `;
  return rows.map((r) => {
    const dt = r.d instanceof Date ? r.d : new Date(r.d);
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const day = String(dt.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  });
}

export type TierKitAvg = {
  tier: 1 | 2 | 3 | 4;
  label: string;
  players: number;
  /** средний % по киту (равный вес игрока), только киты с ненулевым средним */
  kits: KitPctRow[];
};

/** Средний % китов по тирам 1–4 (равный вес игрока внутри тира). */
export async function kitAveragesByTier(): Promise<TierKitAvg[]> {
  const { loadTierIndex } = await import("@/lib/loadTierIndex");
  const tierIndex = await loadTierIndex();

  const users = await prisma.user.findMany({
    where: {
      profileComplete: true,
      nick: { not: null },
      squadRoles: { some: {} },
    },
    select: { id: true, nick: true },
  });

  const emptyTier = (): TierKitAvg[] =>
    ([1, 2, 3, 4] as const).map((tier) => ({
      tier,
      label: `Тир ${tier}`,
      players: 0,
      kits: [],
    }));

  if (!users.length) return emptyTier();

  const grouped = await prisma.$queryRaw<
    { userId: string; kit: string; n: bigint }[]
  >`
    SELECT "userId", kit, COUNT(*)::bigint AS n
    FROM "SquadRoleEvent"
    WHERE "userId" IN (${Prisma.join(users.map((u) => u.id))})
      AND (
        (("spawnedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow')::time >= TIME '21:30:00'
        OR (("spawnedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow')::time < TIME '01:00:00'
      )
    GROUP BY "userId", kit
  `;

  const byUser = new Map<string, Partial<Record<string, number>>>();
  for (const g of grouped) {
    const cur = byUser.get(g.userId) || {};
    const kit = canonKitName(g.kit);
    cur[kit] = (cur[kit] || 0) + (Number(g.n) || 0);
    byUser.set(g.userId, cur);
  }

  type Acc = {
    players: number;
    /** сумма % по киту (потом / players) */
    pctSum: Record<string, number>;
  };
  const acc: Record<1 | 2 | 3 | 4, Acc> = {
    1: { players: 0, pctSum: {} },
    2: { players: 0, pctSum: {} },
    3: { players: 0, pctSum: {} },
    4: { players: 0, pctSum: {} },
  };

  function nickKey(nick: string): string {
    return nick.trim().toLowerCase().replace(/\s+/g, "");
  }

  for (const u of users) {
    const counts = byUser.get(u.id);
    if (!counts) continue;
    const nick = u.nick || "";
    const tierRaw = tierIndex.get(nickKey(nick));
    const tier = (tierRaw === 1 || tierRaw === 2 || tierRaw === 3 || tierRaw === 4
      ? tierRaw
      : 4) as 1 | 2 | 3 | 4;
    const pctRows = kitCountsToPct(counts);
    if (!pctRows.length) continue;
    const bucket = acc[tier];
    bucket.players += 1;
    for (const row of pctRows) {
      bucket.pctSum[row.kit] = (bucket.pctSum[row.kit] || 0) + row.pct;
    }
  }

  const out: TierKitAvg[] = [];
  for (const tier of [1, 2, 3, 4] as const) {
    const b = acc[tier];
    const kits: KitPctRow[] = [];
    if (b.players > 0) {
      for (const [kit, sum] of Object.entries(b.pctSum)) {
        const pct = Math.round((10 * sum) / b.players) / 10;
        if (pct <= 0) continue;
        kits.push({ kit: kit as StandardKit, pct });
      }
      kits.sort((a, b2) => b2.pct - a.pct || a.kit.localeCompare(b2.kit, "ru"));
      const drift =
        Math.round((100 - kits.reduce((s, r) => s + r.pct, 0)) * 10) / 10;
      if (kits.length && Math.abs(drift) >= 0.1) {
        kits[0] = {
          ...kits[0],
          pct: Math.round((kits[0].pct + drift) * 10) / 10,
        };
      }
    }
    out.push({
      tier,
      label: `Тир ${tier}`,
      players: b.players,
      kits,
    });
  }
  return out;
}

export type KitLevelSlot = {
  level: 1 | 2 | 3;
  kit: StandardKit;
  pct: number;
  n: number;
};

export type KitRankPlayer = {
  nick: string;
  tier: 1 | 2 | 3 | 4;
  total: number;
  levels: KitLevelSlot[];
};

export type KitRankKitCount = {
  kit: StandardKit;
  count: number;
  /** доля среди игроков с этим уровнем */
  pct: number;
};

export type KitRankTierKitCount = {
  tier: 1 | 2 | 3 | 4;
  kit: StandardKit;
  count: number;
};

export type KitRankAnalytics = {
  players: KitRankPlayer[];
  /** сводка: сколько раз кит встречается как ур.1 / ур.2 / ур.3 */
  byLevel: Record<1 | 2 | 3, KitRankKitCount[]>;
  /** кит × тир × уровень (для фильтров сводки) */
  byLevelTier: Record<1 | 2 | 3, KitRankTierKitCount[]>;
  insights: {
    players: number;
    avgKitsUsed: number;
    specialistsPct: number;
    riflemanL1Pct: number;
    avgL1Pct: number;
    topL1Kit: string | null;
    rarestL1Kit: string | null;
  };
};

/**
 * Рейтинг китов по игрокам: ур.1 = самый частый, ур.2 = второй, ур.3 = третий.
 * Только зареганные с ролями; тир из tiers.json (иначе 4).
 */
export async function kitRankAnalytics(): Promise<KitRankAnalytics> {
  const { loadTierIndex } = await import("@/lib/loadTierIndex");
  const tierIndex = await loadTierIndex();

  const users = await prisma.user.findMany({
    where: {
      profileComplete: true,
      nick: { not: null },
      squadRoles: { some: {} },
    },
    select: { id: true, nick: true },
  });

  const empty: KitRankAnalytics = {
    players: [],
    byLevel: { 1: [], 2: [], 3: [] },
    byLevelTier: { 1: [], 2: [], 3: [] },
    insights: {
      players: 0,
      avgKitsUsed: 0,
      specialistsPct: 0,
      riflemanL1Pct: 0,
      avgL1Pct: 0,
      topL1Kit: null,
      rarestL1Kit: null,
    },
  };
  if (!users.length) return empty;

  const grouped = await prisma.$queryRaw<
    { userId: string; kit: string; n: bigint }[]
  >`
    SELECT "userId", kit, COUNT(*)::bigint AS n
    FROM "SquadRoleEvent"
    WHERE "userId" IN (${Prisma.join(users.map((u) => u.id))})
      AND (
        (("spawnedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow')::time >= TIME '21:30:00'
        OR (("spawnedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow')::time < TIME '01:00:00'
      )
    GROUP BY "userId", kit
  `;

  const byUser = new Map<string, Partial<Record<string, number>>>();
  for (const g of grouped) {
    const cur = byUser.get(g.userId) || {};
    const kit = canonKitName(g.kit);
    cur[kit] = (cur[kit] || 0) + (Number(g.n) || 0);
    byUser.set(g.userId, cur);
  }

  function nickKey(nick: string): string {
    return nick.trim().toLowerCase().replace(/\s+/g, "");
  }

  const players: KitRankPlayer[] = [];
  let kitsUsedSum = 0;
  let specialists = 0;
  let riflemanL1 = 0;
  let l1PctSum = 0;

  for (const u of users) {
    const counts = byUser.get(u.id);
    if (!counts) continue;
    const nick = (u.nick || "").trim();
    if (!nick) continue;
    const tierRaw = tierIndex.get(nickKey(nick));
    const tier = (tierRaw === 1 || tierRaw === 2 || tierRaw === 3 || tierRaw === 4
      ? tierRaw
      : 4) as 1 | 2 | 3 | 4;

    const rows: { kit: StandardKit; n: number }[] = [];
    let total = 0;
    for (const kit of Object.keys(counts)) {
      const n = Number(counts[kit]) || 0;
      if (n <= 0) continue;
      rows.push({ kit: kit as StandardKit, n });
      total += n;
    }
    if (!total) continue;
    rows.sort(
      (a, b) => b.n - a.n || a.kit.localeCompare(b.kit, "ru")
    );
    const levels: KitLevelSlot[] = rows.slice(0, 3).map((row, i) => ({
      level: (i + 1) as 1 | 2 | 3,
      kit: row.kit,
      pct: Math.round((1000 * row.n) / total) / 10,
      n: row.n,
    }));
    if (!levels.length) continue;

    players.push({ nick, tier, total, levels });
    kitsUsedSum += rows.length;
    l1PctSum += levels[0].pct;
    if (levels[0].kit === "Стрелок") riflemanL1 += 1;
    else specialists += 1;
  }

  players.sort(
    (a, b) =>
      b.levels[0].pct - a.levels[0].pct ||
      a.nick.localeCompare(b.nick, "ru")
  );

  function countsForLevel(level: 1 | 2 | 3): {
    byKit: KitRankKitCount[];
    byTier: KitRankTierKitCount[];
  } {
    const kitMap = new Map<string, number>();
    const tierKitMap = new Map<string, number>();
    let withLevel = 0;
    for (const p of players) {
      const slot = p.levels.find((l) => l.level === level);
      if (!slot) continue;
      withLevel += 1;
      kitMap.set(slot.kit, (kitMap.get(slot.kit) || 0) + 1);
      const tk = `${p.tier}|${slot.kit}`;
      tierKitMap.set(tk, (tierKitMap.get(tk) || 0) + 1);
    }
    const byKit: KitRankKitCount[] = [...kitMap.entries()]
      .map(([kit, count]) => ({
        kit: kit as StandardKit,
        count,
        pct:
          withLevel > 0
            ? Math.round((1000 * count) / withLevel) / 10
            : 0,
      }))
      .sort(
        (a, b) => b.count - a.count || a.kit.localeCompare(b.kit, "ru")
      );
    const byTier: KitRankTierKitCount[] = [...tierKitMap.entries()]
      .map(([key, count]) => {
        const [t, kit] = key.split("|");
        return {
          tier: Number(t) as 1 | 2 | 3 | 4,
          kit: kit as StandardKit,
          count,
        };
      })
      .sort(
        (a, b) =>
          a.tier - b.tier ||
          b.count - a.count ||
          a.kit.localeCompare(b.kit, "ru")
      );
    return { byKit, byTier };
  }

  const byLevel: KitRankAnalytics["byLevel"] = { 1: [], 2: [], 3: [] };
  const byLevelTier: KitRankAnalytics["byLevelTier"] = {
    1: [],
    2: [],
    3: [],
  };
  for (const lv of [1, 2, 3] as const) {
    const { byKit, byTier } = countsForLevel(lv);
    byLevel[lv] = byKit;
    byLevelTier[lv] = byTier;
  }

  const l1 = byLevel[1];
  const n = players.length;
  return {
    players,
    byLevel,
    byLevelTier,
    insights: {
      players: n,
      avgKitsUsed: n ? Math.round((10 * kitsUsedSum) / n) / 10 : 0,
      specialistsPct: n
        ? Math.round((1000 * specialists) / n) / 10
        : 0,
      riflemanL1Pct: n
        ? Math.round((1000 * riflemanL1) / n) / 10
        : 0,
      avgL1Pct: n ? Math.round((10 * l1PctSum) / n) / 10 : 0,
      topL1Kit: l1[0]?.kit || null,
      rarestL1Kit: l1.length ? l1[l1.length - 1].kit : null,
    },
  };
}

export { kitFromDeployRole, formatMskYmd, normalizeEosId, normalizeSteamId };
