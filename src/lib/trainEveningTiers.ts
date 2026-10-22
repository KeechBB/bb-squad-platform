/**
 * Состав unique по вечерам (21:00–00:00) с разбивкой по тирам T1–T4.
 * T4 = не в списках T1–T3 (гости / без тира).
 */
import { prisma } from "@/lib/prisma";
import { loadTierIndex } from "@/lib/loadTierIndex";
import { TRAINING_SERVER_KEYS } from "@/lib/squadServers";
import {
  availableDynamicsMonths,
  resolveDynamicsRange,
  todayEveYmdMsk,
} from "@/lib/trainEveningDynamics";

export const TIER_KEYS = ["T1", "T2", "T3", "T4"] as const;
export type TierKey = (typeof TIER_KEYS)[number];

export const TIER_COLORS: Record<TierKey, string> = {
  T1: "#7dd3fc",
  T2: "#86efac",
  T3: "#fde047",
  T4: "#a78bfa",
};

const DOW = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"] as const;
const MSK_OFFSET_MS = 3 * 3600 * 1000;

export type EveningTierDay = {
  day: string;
  label: string;
  dow: string;
  counts: Record<TierKey, number>;
  total: number;
  isToday: boolean;
};

export type EveningTierBoard = {
  mode: "week" | "month";
  from: string;
  to: string;
  window: "21:00–00:00 МСК";
  servers: "TR1 + TR2";
  todayEve: string;
  days: EveningTierDay[];
  today: EveningTierDay;
  avg: Record<TierKey, number>;
  monthUnique: Record<TierKey, number>;
  sumEvenings: Record<TierKey, number>;
  updatedAt: string;
};

function nickKey(n: string): string {
  return n.trim().toLowerCase().replace(/\s+/g, "");
}

function ymdFromParts(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function addDaysYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d) + delta * 24 * 3600 * 1000;
  const t = new Date(utc);
  return ymdFromParts(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

function mskMidnightUtc(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - MSK_OFFSET_MS);
}

function eveningBoundsUtc(dayYmd: string): { start: Date; end: Date } {
  const mid = mskMidnightUtc(dayYmd);
  return {
    start: new Date(mid.getTime() + 21 * 3600 * 1000),
    end: new Date(mid.getTime() + 24 * 3600 * 1000),
  };
}

function weekdayRu(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
  return DOW[dow === 0 ? 6 : dow - 1];
}

function emptyCounts(): Record<TierKey, number> {
  return { T1: 0, T2: 0, T3: 0, T4: 0 };
}

function tierOf(nick: string, index: Map<string, 1 | 2 | 3>): TierKey {
  const t = index.get(nickKey(nick));
  if (t === 1) return "T1";
  if (t === 2) return "T2";
  if (t === 3) return "T3";
  return "T4";
}

type Sess = { nick: string; joined: Date; left: Date | null };

function dayMetrics(
  sessions: Sess[],
  dayYmd: string,
  todayEve: string,
  index: Map<string, 1 | 2 | 3>
): EveningTierDay {
  const { start, end } = eveningBoundsUtc(dayYmd);
  const by: Record<TierKey, Set<string>> = {
    T1: new Set(),
    T2: new Set(),
    T3: new Set(),
    T4: new Set(),
  };
  for (const s of sessions) {
    const j = s.joined.getTime();
    let l = (s.left || end).getTime();
    if (l < j) l = j;
    if (!(j < end.getTime() && l > start.getTime())) continue;
    const cj = Math.max(j, start.getTime());
    const cl = Math.min(l, end.getTime());
    if (cl <= cj) continue;
    by[tierOf(s.nick, index)].add(s.nick);
  }
  const counts = emptyCounts();
  for (const k of TIER_KEYS) counts[k] = by[k].size;
  const [, mo, dd] = dayYmd.split("-");
  return {
    day: dayYmd,
    label: `${dd}.${mo}`,
    dow: weekdayRu(dayYmd),
    counts,
    total: TIER_KEYS.reduce((s, k) => s + counts[k], 0),
    isToday: dayYmd === todayEve,
  };
}

export async function buildEveningTierDynamics(opts: {
  mode: "week" | "month";
  month?: string | null;
  end?: string | null;
}): Promise<EveningTierBoard> {
  const todayEve = todayEveYmdMsk();
  const { from, to } = resolveDynamicsRange(opts.mode, {
    month: opts.month,
    end: opts.end,
  });

  const [tierIndex, raw] = await Promise.all([
    loadTierIndex(),
    prisma.squadServerSession.findMany({
      where: {
        serverKey: { in: [...TRAINING_SERVER_KEYS] },
        joinedAt: {
          gte: new Date(mskMidnightUtc(from).getTime() + 12 * 3600 * 1000),
          lt: new Date(mskMidnightUtc(to).getTime() + 30 * 3600 * 1000),
        },
      },
      select: {
        steamId: true,
        nickAtJoin: true,
        joinedAt: true,
        leftAt: true,
        user: { select: { nick: true } },
      },
    }),
  ]);

  const sessions: Sess[] = raw.map((s) => ({
    nick:
      (s.user?.nick || "").trim() ||
      (s.nickAtJoin || "").trim() ||
      s.steamId ||
      "?",
    joined: s.joinedAt,
    left: s.leftAt,
  }));

  const days: EveningTierDay[] = [];
  const monthUnique: Record<TierKey, Set<string>> = {
    T1: new Set(),
    T2: new Set(),
    T3: new Set(),
    T4: new Set(),
  };
  const sumEvenings = emptyCounts();

  for (let cur = from; ; cur = addDaysYmd(cur, 1)) {
    const m = dayMetrics(sessions, cur, todayEve, tierIndex);
    days.push(m);
    for (const k of TIER_KEYS) sumEvenings[k] += m.counts[k];

    const { start, end } = eveningBoundsUtc(cur);
    for (const s of sessions) {
      const j = s.joined.getTime();
      let l = (s.left || end).getTime();
      if (l < j) l = j;
      if (!(j < end.getTime() && l > start.getTime())) continue;
      if (Math.min(l, end.getTime()) <= Math.max(j, start.getTime())) continue;
      monthUnique[tierOf(s.nick, tierIndex)].add(s.nick);
    }
    if (cur >= to) break;
  }

  const active = days.filter((d) => d.total > 0);
  const avg = emptyCounts();
  for (const k of TIER_KEYS) {
    avg[k] = active.length
      ? Math.round(active.reduce((s, d) => s + d.counts[k], 0) / active.length)
      : 0;
  }

  const today = days.find((d) => d.isToday) || days[days.length - 1];

  return {
    mode: opts.mode,
    from,
    to,
    window: "21:00–00:00 МСК",
    servers: "TR1 + TR2",
    todayEve,
    days,
    today,
    avg,
    monthUnique: {
      T1: monthUnique.T1.size,
      T2: monthUnique.T2.size,
      T3: monthUnique.T3.size,
      T4: monthUnique.T4.size,
    },
    sumEvenings,
    updatedAt: new Date().toISOString(),
  };
}

export { availableDynamicsMonths };
