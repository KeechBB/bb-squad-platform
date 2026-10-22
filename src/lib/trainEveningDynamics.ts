/**
 * Динамика вечерних трень (21:00–00:00 МСК) на TR1+TR2:
 * unique зашедших + пик одновременного online.
 */
import { prisma } from "@/lib/prisma";
import { mskParts, ATTENDANCE_CANON_START_YMD } from "@/lib/squadSessions";
import { TRAINING_SERVER_KEYS } from "@/lib/squadServers";

const DOW = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"] as const;
const MSK_OFFSET_MS = 3 * 3600 * 1000;

export type EveningDayMetrics = {
  day: string;
  label: string;
  dow: string;
  unique: number;
  peak: number;
  tr1Unique: number;
  tr2Unique: number;
  tr1Peak: number;
  tr2Peak: number;
  isToday: boolean;
};

export type EveningDynamicsBoard = {
  mode: "week" | "month";
  from: string;
  to: string;
  window: "21:00–00:00 МСК";
  servers: "TR1 + TR2";
  todayEve: string;
  days: EveningDayMetrics[];
  today: EveningDayMetrics;
  avgUnique: number;
  avgPeak: number;
  maxUnique: EveningDayMetrics;
  maxPeak: EveningDayMetrics;
  updatedAt: string;
};

function ymdFromParts(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function todayYmdMsk(now = new Date()): string {
  const p = mskParts(now);
  return ymdFromParts(p.y, p.m, p.day);
}

/** Вечер «сегодня»: до 12:00 МСК — вчерашняя ночь. */
export function todayEveYmdMsk(now = new Date()): string {
  const p = mskParts(now);
  if (p.h < 12) {
    const utc = Date.UTC(p.y, p.m - 1, p.day) - 24 * 3600 * 1000;
    const d = new Date(utc);
    return ymdFromParts(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  return ymdFromParts(p.y, p.m, p.day);
}

function addDaysYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d) + delta * 24 * 3600 * 1000;
  const t = new Date(utc);
  return ymdFromParts(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

function clampYmd(ymd: string): string {
  return ymd < ATTENDANCE_CANON_START_YMD ? ATTENDANCE_CANON_START_YMD : ymd;
}

/** Начало дня ymd в МСК → UTC Date */
function mskMidnightUtc(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - MSK_OFFSET_MS);
}

function eveningBoundsUtc(dayYmd: string): { start: Date; end: Date } {
  const mid = mskMidnightUtc(dayYmd);
  const start = new Date(mid.getTime() + 21 * 3600 * 1000);
  const end = new Date(mid.getTime() + 24 * 3600 * 1000);
  return { start, end };
}

function weekdayRu(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  // JS: 0=Sun … use UTC noon to avoid TZ edge
  const dow = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
  const monBased = dow === 0 ? 6 : dow - 1;
  return DOW[monBased];
}

export function resolveDynamicsRange(
  mode: "week" | "month",
  opts: { month?: string | null; end?: string | null; now?: Date }
): { from: string; to: string } {
  const now = opts.now || new Date();
  const eve = todayEveYmdMsk(now);
  if (mode === "week") {
    const to = clampYmd(opts.end && opts.end <= eve ? opts.end : eve);
    const from = clampYmd(addDaysYmd(to, -6));
    return { from, to };
  }
  // month YYYY-MM
  let ym = (opts.month || "").trim();
  if (!/^\d{4}-\d{2}$/.test(ym)) {
    ym = eve.slice(0, 7);
  }
  const [y, m] = ym.split("-").map(Number);
  const fromRaw = ymdFromParts(y, m, 1);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const monthEnd = ymdFromParts(y, m, lastDay);
  const to = clampYmd(monthEnd > eve ? eve : monthEnd);
  const from = clampYmd(fromRaw);
  return { from: from > to ? to : from, to };
}

type Sess = {
  nick: string;
  server: "TR1" | "TR2";
  joined: Date;
  left: Date | null;
};

function metricsForDay(sessions: Sess[], dayYmd: string, todayEve: string): EveningDayMetrics {
  const { start, end } = eveningBoundsUtc(dayYmd);
  const uniques = new Set<string>();
  const byU = { TR1: new Set<string>(), TR2: new Set<string>() };
  const byPeak = { TR1: 0, TR2: 0 };
  const events: Array<{ t: number; delta: 1 | -1; srv: "TR1" | "TR2" }> = [];

  for (const s of sessions) {
    const j = s.joined.getTime();
    let l = (s.left || end).getTime();
    if (l < j) l = j;
    if (!(j < end.getTime() && l > start.getTime())) continue;
    const cj = Math.max(j, start.getTime());
    const cl = Math.min(l, end.getTime());
    if (cl <= cj) continue;
    uniques.add(s.nick);
    byU[s.server].add(s.nick);
    events.push({ t: cj, delta: 1, srv: s.server });
    events.push({ t: cl, delta: -1, srv: s.server });
  }

  events.sort((a, b) => a.t - b.t || a.delta - b.delta); // leaves (-1) before joins

  let online = 0;
  let peak = 0;
  const onlineS = { TR1: 0, TR2: 0 };
  for (const e of events) {
    online += e.delta;
    if (online > peak) peak = online;
    onlineS[e.srv] += e.delta;
    if (onlineS[e.srv] > byPeak[e.srv]) byPeak[e.srv] = onlineS[e.srv];
  }

  const [, mo, dd] = dayYmd.split("-");
  return {
    day: dayYmd,
    label: `${dd}.${mo}`,
    dow: weekdayRu(dayYmd),
    unique: uniques.size,
    peak,
    tr1Unique: byU.TR1.size,
    tr2Unique: byU.TR2.size,
    tr1Peak: byPeak.TR1,
    tr2Peak: byPeak.TR2,
    isToday: dayYmd === todayEve,
  };
}

export async function buildEveningDynamics(opts: {
  mode: "week" | "month";
  month?: string | null;
  end?: string | null;
}): Promise<EveningDynamicsBoard> {
  const todayEve = todayEveYmdMsk();
  const { from, to } = resolveDynamicsRange(opts.mode, {
    month: opts.month,
    end: opts.end,
  });

  const rangeStart = new Date(mskMidnightUtc(from).getTime() + 12 * 3600 * 1000);
  const rangeEnd = new Date(mskMidnightUtc(to).getTime() + 30 * 3600 * 1000);

  const raw = await prisma.squadServerSession.findMany({
    where: {
      serverKey: { in: [...TRAINING_SERVER_KEYS] },
      joinedAt: { gte: rangeStart, lt: rangeEnd },
    },
    select: {
      serverKey: true,
      steamId: true,
      nickAtJoin: true,
      joinedAt: true,
      leftAt: true,
      user: { select: { nick: true } },
    },
  });

  const sessions: Sess[] = raw.map((s) => {
    const nick =
      (s.user?.nick || "").trim() ||
      (s.nickAtJoin || "").trim() ||
      s.steamId ||
      "?";
    const key = String(s.serverKey || "").toUpperCase();
    const server: "TR1" | "TR2" = key === "TR2" ? "TR2" : "TR1";
    return {
      nick,
      server,
      joined: s.joinedAt,
      left: s.leftAt,
    };
  });

  const days: EveningDayMetrics[] = [];
  for (let cur = from; ; cur = addDaysYmd(cur, 1)) {
    days.push(metricsForDay(sessions, cur, todayEve));
    if (cur >= to) break;
  }

  const active = days.filter((d) => d.unique > 0 || d.peak > 0);
  const avgUnique = active.length
    ? Math.round(active.reduce((s, d) => s + d.unique, 0) / active.length)
    : 0;
  const avgPeak = active.length
    ? Math.round(active.reduce((s, d) => s + d.peak, 0) / active.length)
    : 0;
  const maxUnique = days.reduce((a, b) => (b.unique > a.unique ? b : a), days[0]);
  const maxPeak = days.reduce((a, b) => (b.peak > a.peak ? b : a), days[0]);
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
    avgUnique,
    avgPeak,
    maxUnique,
    maxPeak,
    updatedAt: new Date().toISOString(),
  };
}

/** Список YYYY-MM от канона до текущего вечера. */
export function availableDynamicsMonths(now = new Date()): string[] {
  const eve = todayEveYmdMsk(now);
  const out: string[] = [];
  let cur = ATTENDANCE_CANON_START_YMD.slice(0, 7);
  const end = eve.slice(0, 7);
  while (cur <= end) {
    out.push(cur);
    const [y, m] = cur.split("-").map(Number);
    const nextM = m === 12 ? 1 : m + 1;
    const nextY = m === 12 ? y + 1 : y;
    cur = `${nextY}-${String(nextM).padStart(2, "0")}`;
  }
  return out;
}
