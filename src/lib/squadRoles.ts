import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { mskDayBoundsUtc, formatMskYmd } from "@/lib/squadHits";
import {
  kitCountsToPct,
  kitFromDeployRole,
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

export type KitsForUserOpts = {
  /** Один день МСК YYYY-MM-DD */
  dayYmd?: string | null;
  /** Интервал МСК включительно: from..to */
  fromYmd?: string | null;
  toYmd?: string | null;
};

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
  const rows = range
    ? await prisma.$queryRaw<{ kit: string; n: bigint }[]>`
        SELECT kit, COUNT(*)::bigint AS n
        FROM "SquadRoleEvent"
        WHERE "userId" = ${userId}
          AND "spawnedAt" >= ${range.gte}
          AND "spawnedAt" < ${range.lt}
          AND (
            (("spawnedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow')::time >= TIME '21:30:00'
            OR (("spawnedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow')::time < TIME '01:00:00'
          )
        GROUP BY kit
      `
    : await prisma.$queryRaw<{ kit: string; n: bigint }[]>`
        SELECT kit, COUNT(*)::bigint AS n
        FROM "SquadRoleEvent"
        WHERE "userId" = ${userId}
          AND (
            (("spawnedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow')::time >= TIME '21:30:00'
            OR (("spawnedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow')::time < TIME '01:00:00'
          )
        GROUP BY kit
      `;
  const counts: Partial<Record<string, number>> = {};
  let total = 0;
  for (const r of rows) {
    const n = Number(r.n) || 0;
    if (n <= 0) continue;
    counts[r.kit] = n;
    total += n;
  }
  return { kits: kitCountsToPct(counts), total };
}

/** Дни МСК со спавнами ролей в боевом окне (календарь). */
export async function kitDaysForUser(userId: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ d: Date }[]>`
    SELECT DISTINCT (
      (("spawnedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow')::date
    ) AS d
    FROM "SquadRoleEvent"
    WHERE "userId" = ${userId}
      AND (
        (("spawnedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow')::time >= TIME '21:30:00'
        OR (("spawnedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow')::time < TIME '01:00:00'
      )
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
  const { loadTierIndex } = await import("@/lib/tiers");
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
    cur[g.kit] = Number(g.n) || 0;
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
    return nick.trim().toLowerCase().replace(/\s+/g, " ");
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

export { kitFromDeployRole, formatMskYmd, normalizeEosId, normalizeSteamId };
