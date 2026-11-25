/**
 * PB1 (TPUB*) online analytics: hour timeline, uniques, new Steam IDs, wake time.
 * Calendar MSK day/week/month/year. Day rollups cached on disk.
 */
import fs from "fs";
import path from "path";
import { prisma } from "@/lib/prisma";

export const PB1_SERVER_KEYS = ["TPUB1", "PB1", "TPUB", "PUBLIC"] as const;

const STAFF_ROLES = [
  "SUPER_ADMIN",
  "ADMIN",
  "PUBLIC_ADMIN",
  "DEPUTY",
  "HR",
] as const;

/** Онлайн > 50 = сервер «поднялся» (после SEED). */
const WAKE_MIN_CONCURRENT = 51;
const WAKE_FROM_HOUR_MSK = 8; // ignore overnight leftovers
const CACHE_DIR = path.join(process.cwd(), "data", "cache", "pb1-analytics");
const MEM_TTL_MS = 5 * 60_000;

type HourBucket = {
  hour: number;
  total: number;
  players: number;
  staff: number;
};

export type Pb1DayRollup = {
  ymd: string;
  hours: HourBucket[];
  uniqueSteamIds: number;
  newSteamIds: number;
  peakHourUnique: number;
  peakHour: number;
  playerHours: number;
  /** минуты от 00:00 МСК, когда онлайн впервые ≥ порога */
  wakeMskMinutes: number | null;
  sessionCount: number;
};

export type Pb1AnalyticsScope = "day" | "week" | "month" | "year";

export type Pb1AnalyticsPayload = {
  scope: Pb1AnalyticsScope;
  /** Календарный якорь: день / любой день недели / YYYY-MM / YYYY */
  key: string;
  label: string;
  range: { fromYmd: string; toYmd: string };
  timeline: HourBucket[];
  /** для day — абсолют; для week/month/year — среднее по дням с данными */
  timelineMode: "absolute" | "average";
  daysWithData: number;
  stats: {
    uniqueSteamIds: number;
    uniqueSteamIdsDay: number;
    uniqueSteamIdsWeek: number;
    uniqueSteamIdsMonth: number;
    newSteamIdsDay: number;
    newSteamIdsWeek: number;
    newSteamIdsMonth: number;
    wakeAvgWeek: string | null;
    wakeAvgMonth: string | null;
    peakHourUnique: number;
    peakHour: number;
    playerHours: number;
    avgSessionMin: number | null;
    busyHour: number;
    quietHour: number;
  };
  updatedAt: string;
};

type SessionLite = {
  steamId: string;
  joinedAt: Date;
  leftAt: Date | null;
};

const mem = new Map<string, { at: number; data: unknown }>();

function memGet<T>(key: string): T | null {
  const hit = mem.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > MEM_TTL_MS) {
    mem.delete(key);
    return null;
  }
  return hit.data as T;
}

function memSet(key: string, data: unknown) {
  mem.set(key, { at: Date.now(), data });
}

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function pad2(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

export function mskYmd(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** MSK calendar day → [start, end) UTC */
export function mskDayBounds(ymd: string): { start: Date; end: Date } {
  const [y, m, d] = ymd.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, d, -3, 0, 0));
  const end = new Date(Date.UTC(y, m - 1, d + 1, -3, 0, 0));
  return { start, end };
}

function addDaysYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(
    dt.getUTCDate()
  )}`;
}

function daysInclusive(fromYmd: string, toYmd: string): string[] {
  const out: string[] = [];
  let cur = fromYmd;
  while (cur <= toYmd) {
    out.push(cur);
    cur = addDaysYmd(cur, 1);
    if (out.length > 400) break;
  }
  return out;
}

/** Понедельник–воскресенье недели, содержащей ymd (календарь МСК). */
export function weekBoundsFromYmd(ymd: string): { fromYmd: string; toYmd: string } {
  const [y, m, d] = ymd.split("-").map(Number);
  // noon UTC ≈ safe for weekday in MSK
  const noon = new Date(Date.UTC(y, m - 1, d, 9, 0, 0));
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Moscow",
    weekday: "short",
  }).format(noon);
  const map: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  };
  const offset = map[wd] ?? 0;
  const fromYmd = addDaysYmd(ymd, -offset);
  const toYmd = addDaysYmd(fromYmd, 6);
  return { fromYmd, toYmd };
}

export function monthBounds(year: number, month: number): {
  fromYmd: string;
  toYmd: string;
} {
  const fromYmd = `${year}-${pad2(month)}-01`;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const toYmd = `${year}-${pad2(month)}-${pad2(last)}`;
  return { fromYmd, toYmd };
}

export function yearBounds(year: number): { fromYmd: string; toYmd: string } {
  return { fromYmd: `${year}-01-01`, toYmd: `${year}-12-31` };
}

function fmtMskHm(mins: number | null): string | null {
  if (mins == null || !Number.isFinite(mins)) return null;
  const m = Math.max(0, Math.min(24 * 60 - 1, Math.round(mins)));
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

async function loadStaffSteamSet(): Promise<Set<string>> {
  const cached = memGet<string[]>("staff-steams");
  if (cached) return new Set(cached);
  const rows = await prisma.user.findMany({
    where: { role: { in: [...STAFF_ROLES] } },
    select: { steamId: true },
  });
  const ids = rows.map((r) => r.steamId).filter(Boolean);
  memSet("staff-steams", ids);
  return new Set(ids);
}

async function loadSessionsForDay(ymd: string): Promise<SessionLite[]> {
  const { start, end } = mskDayBounds(ymd);
  // sessions that can overlap the day
  const padStart = new Date(start.getTime() - 12 * 3600_000);
  const rows = await prisma.squadServerSession.findMany({
    where: {
      serverKey: { in: [...PB1_SERVER_KEYS] },
      joinedAt: { lt: end },
      OR: [{ leftAt: null }, { leftAt: { gt: padStart } }],
    },
    select: { steamId: true, joinedAt: true, leftAt: true },
  });
  const now = Date.now();
  const dayEnd = end.getTime();
  const dayStart = start.getTime();
  return rows
    .map((r) => {
      const left = r.leftAt ? r.leftAt.getTime() : now;
      // cap open sessions at day end for historical days
      const leftCap = Math.min(left, Math.max(now, dayEnd));
      return {
        steamId: r.steamId,
        joinedAt: r.joinedAt,
        leftAt: new Date(Math.min(leftCap, dayEnd + 12 * 3600_000)),
      };
    })
    .filter((r) => {
      const a = r.joinedAt.getTime();
      const b = r.leftAt!.getTime();
      return a < dayEnd && b > dayStart;
    });
}

function overlapMs(a0: number, a1: number, b0: number, b1: number): number {
  const s = Math.max(a0, b0);
  const e = Math.min(a1, b1);
  return Math.max(0, e - s);
}

function buildDayRollup(
  ymd: string,
  sessions: SessionLite[],
  staff: Set<string>,
  firstSeen: Map<string, string>
): Pb1DayRollup {
  const { start, end } = mskDayBounds(ymd);
  const dayStart = start.getTime();
  const dayEnd = end.getTime();
  const hours: HourBucket[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    total: 0,
    players: 0,
    staff: 0,
  }));

  const uniques = new Set<string>();
  let playerHours = 0;
  let sessionCount = 0;

  for (const s of sessions) {
    const a = s.joinedAt.getTime();
    const b = (s.leftAt || new Date()).getTime();
    const ov = overlapMs(a, b, dayStart, dayEnd);
    if (ov <= 0) continue;
    sessionCount++;
    uniques.add(s.steamId);
    playerHours += ov / 3600_000;
    for (let hour = 0; hour < 24; hour++) {
      const h0 = dayStart + hour * 3600_000;
      const h1 = h0 + 3600_000;
      if (overlapMs(a, b, h0, h1) > 0) {
        // counted per unique below
      }
    }
  }

  // unique per hour
  for (let hour = 0; hour < 24; hour++) {
    const h0 = dayStart + hour * 3600_000;
    const h1 = h0 + 3600_000;
    const setP = new Set<string>();
    const setS = new Set<string>();
    for (const s of sessions) {
      const a = s.joinedAt.getTime();
      const b = (s.leftAt || new Date()).getTime();
      if (overlapMs(a, b, h0, h1) <= 0) continue;
      if (staff.has(s.steamId)) setS.add(s.steamId);
      else setP.add(s.steamId);
    }
    hours[hour] = {
      hour,
      players: setP.size,
      staff: setS.size,
      total: setP.size + setS.size,
    };
  }

  let peakHourUnique = 0;
  let peakHour = 0;
  for (const h of hours) {
    if (h.total > peakHourUnique) {
      peakHourUnique = h.total;
      peakHour = h.hour;
    }
  }

  // wake: sample every 10 min from 08:00, first concurrent >= threshold
  let wakeMskMinutes: number | null = null;
  for (let mins = WAKE_FROM_HOUR_MSK * 60; mins < 22 * 60; mins += 10) {
    const t = dayStart + mins * 60_000;
    let conc = 0;
    for (const s of sessions) {
      const a = s.joinedAt.getTime();
      const b = (s.leftAt || new Date()).getTime();
      if (a <= t && b > t) conc++;
    }
    if (conc >= WAKE_MIN_CONCURRENT) {
      wakeMskMinutes = mins;
      break;
    }
  }

  let newSteamIds = 0;
  for (const sid of uniques) {
    const first = firstSeen.get(sid);
    if (first === ymd) newSteamIds++;
  }

  return {
    ymd,
    hours,
    uniqueSteamIds: uniques.size,
    newSteamIds,
    peakHourUnique,
    peakHour,
    playerHours: Math.round(playerHours * 10) / 10,
    wakeMskMinutes,
    sessionCount,
  };
}

async function loadFirstSeenMap(): Promise<Map<string, string>> {
  const cached = memGet<[string, string][]>("first-seen");
  if (cached) return new Map(cached);

  const rows = await prisma.$queryRaw<
    { steamId: string; firstAt: Date }[]
  >`SELECT "steamId", MIN("joinedAt") AS "firstAt"
    FROM "SquadServerSession"
    WHERE "serverKey" IN ('TPUB1','PB1','TPUB','PUBLIC')
    GROUP BY "steamId"`;

  const pairs: [string, string][] = rows.map((r) => [
    r.steamId,
    mskYmd(new Date(r.firstAt)),
  ]);
  memSet("first-seen", pairs);
  return new Map(pairs);
}

function dayCachePath(ymd: string) {
  return path.join(CACHE_DIR, `day-${ymd}.json`);
}

export async function getDayRollup(ymd: string): Promise<Pb1DayRollup> {
  const memKey = `day:${ymd}`;
  const hit = memGet<Pb1DayRollup>(memKey);
  if (hit) return hit;

  ensureCacheDir();
  const fp = dayCachePath(ymd);
  const today = mskYmd(new Date());
  if (ymd < today && fs.existsSync(fp)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(fp, "utf8")) as Pb1DayRollup;
      memSet(memKey, parsed);
      return parsed;
    } catch {
      /* rebuild */
    }
  }

  const [sessions, staff, firstSeen] = await Promise.all([
    loadSessionsForDay(ymd),
    loadStaffSteamSet(),
    loadFirstSeenMap(),
  ]);
  const rollup = buildDayRollup(ymd, sessions, staff, firstSeen);
  memSet(memKey, rollup);
  if (ymd < today) {
    try {
      fs.writeFileSync(fp, JSON.stringify(rollup));
    } catch {
      /* ignore */
    }
  }
  return rollup;
}

async function averageTimeline(days: Pb1DayRollup[]): Promise<HourBucket[]> {
  const withData = days.filter((d) => d.uniqueSteamIds > 0);
  const n = withData.length || 1;
  return Array.from({ length: 24 }, (_, hour) => {
    let total = 0;
    let players = 0;
    let staff = 0;
    for (const d of withData) {
      const h = d.hours[hour]!;
      total += h.total;
      players += h.players;
      staff += h.staff;
    }
    return {
      hour,
      total: Math.round((total / n) * 10) / 10,
      players: Math.round((players / n) * 10) / 10,
      staff: Math.round((staff / n) * 10) / 10,
    };
  });
}

function avgWake(days: Pb1DayRollup[]): number | null {
  const vals = days
    .map((d) => d.wakeMskMinutes)
    .filter((v): v is number => v != null);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function monthNameRu(month: number): string {
  const names = [
    "",
    "Январь",
    "Февраль",
    "Март",
    "Апрель",
    "Май",
    "Июнь",
    "Июль",
    "Август",
    "Сентябрь",
    "Октябрь",
    "Ноябрь",
    "Декабрь",
  ];
  return names[month] || String(month);
}

export async function buildPb1Analytics(opts: {
  scope: Pb1AnalyticsScope;
  /** day: YYYY-MM-DD; week: YYYY-MM-DD (any day in week); month: YYYY-MM; year: YYYY */
  key: string;
}): Promise<Pb1AnalyticsPayload> {
  const scope = opts.scope;
  let key = String(opts.key || "").trim();
  const today = mskYmd(new Date());

  let fromYmd = today;
  let toYmd = today;
  let label = today;

  if (scope === "day") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) key = today;
    fromYmd = key;
    toYmd = key;
    label = key.split("-").reverse().join(".");
  } else if (scope === "week") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) key = today;
    const w = weekBoundsFromYmd(key);
    fromYmd = w.fromYmd;
    toYmd = w.toYmd;
    label = `неделя ${fromYmd.split("-").reverse().join(".")}–${toYmd
      .split("-")
      .reverse()
      .join(".")}`;
  } else if (scope === "month") {
    if (!/^\d{4}-\d{2}$/.test(key)) key = today.slice(0, 7);
    const [y, m] = key.split("-").map(Number);
    const b = monthBounds(y, m);
    fromYmd = b.fromYmd;
    toYmd = b.toYmd;
    label = `${monthNameRu(m)} ${y}`;
  } else {
    if (!/^\d{4}$/.test(key)) key = today.slice(0, 4);
    const y = Number(key);
    const b = yearBounds(y);
    fromYmd = b.fromYmd;
    toYmd = b.toYmd;
    label = String(y);
  }

  // clamp future
  if (toYmd > today) toYmd = today;
  if (fromYmd > today) fromYmd = today;

  const cacheKey = `payload:${scope}:${key}:${fromYmd}:${toYmd}`;
  const cached = memGet<Pb1AnalyticsPayload>(cacheKey);
  if (cached) return cached;

  const ymds = daysInclusive(fromYmd, toYmd);
  const rollups: Pb1DayRollup[] = [];
  // modest parallelism — day rollups are disk/mem cached after first build
  const CONC = 4;
  for (let i = 0; i < ymds.length; i += CONC) {
    const chunk = ymds.slice(i, i + CONC);
    const part = await Promise.all(chunk.map((ymd) => getDayRollup(ymd)));
    rollups.push(...part);
  }

  const withData = rollups.filter((d) => d.uniqueSteamIds > 0);
  const timeline =
    scope === "day"
      ? rollups[0]?.hours ||
        Array.from({ length: 24 }, (_, hour) => ({
          hour,
          total: 0,
          players: 0,
          staff: 0,
        }))
      : await averageTimeline(rollups);

  // period uniques / new — union across days from firstSeen + sessions is heavy;
  // use rollup sums carefully for new (sum of daily new is correct if first-seen day);
  // for unique need re-query or approximate.
  const uniqueExact = await countUniqueInRange(fromYmd, toYmd);
  const newExact = await countNewInRange(fromYmd, toYmd);

  // contextual day/week/month cards relative to selected anchor
  const anchorDay = scope === "day" ? fromYmd : toYmd;
  const weekB = weekBoundsFromYmd(anchorDay);
  const [ay, am] = anchorDay.split("-").map(Number);
  const monthB = monthBounds(ay, am);

  const [
    uniqueDay,
    uniqueWeek,
    uniqueMonth,
    newDay,
    newWeek,
    newMonth,
  ] = await Promise.all([
    countUniqueInRange(anchorDay, anchorDay),
    countUniqueInRange(weekB.fromYmd, weekB.toYmd > today ? today : weekB.toYmd),
    countUniqueInRange(monthB.fromYmd, monthB.toYmd > today ? today : monthB.toYmd),
    countNewInRange(anchorDay, anchorDay),
    countNewInRange(weekB.fromYmd, weekB.toYmd > today ? today : weekB.toYmd),
    countNewInRange(monthB.fromYmd, monthB.toYmd > today ? today : monthB.toYmd),
  ]);

  const wakeWeek = avgWake(
    (
      await Promise.all(
        daysInclusive(
          weekB.fromYmd,
          weekB.toYmd > today ? today : weekB.toYmd
        ).map((d) => getDayRollup(d))
      )
    )
  );
  const wakeMonth = avgWake(
    (
      await Promise.all(
        daysInclusive(
          monthB.fromYmd,
          monthB.toYmd > today ? today : monthB.toYmd
        ).map((d) => getDayRollup(d))
      )
    )
  );

  const playerHours = Math.round(
    withData.reduce((s, d) => s + d.playerHours, 0) * 10
  ) / 10;
  const sessions = withData.reduce((s, d) => s + d.sessionCount, 0);
  const avgSessionMin =
    sessions > 0
      ? Math.round((playerHours * 60) / sessions)
      : null;

  let busyHour = 0;
  let quietHour = 0;
  let busyVal = -1;
  let quietVal = Infinity;
  for (const h of timeline) {
    if (h.total > busyVal) {
      busyVal = h.total;
      busyHour = h.hour;
    }
    if (h.total < quietVal) {
      quietVal = h.total;
      quietHour = h.hour;
    }
  }

  const peak = withData.reduce(
    (best, d) =>
      d.peakHourUnique > best.peakHourUnique
        ? { peakHourUnique: d.peakHourUnique, peakHour: d.peakHour }
        : best,
    { peakHourUnique: 0, peakHour: 0 }
  );

  const payload: Pb1AnalyticsPayload = {
    scope,
    key,
    label,
    range: { fromYmd, toYmd },
    timeline,
    timelineMode: scope === "day" ? "absolute" : "average",
    daysWithData: withData.length,
    stats: {
      uniqueSteamIds: uniqueExact,
      uniqueSteamIdsDay: uniqueDay,
      uniqueSteamIdsWeek: uniqueWeek,
      uniqueSteamIdsMonth: uniqueMonth,
      newSteamIdsDay: newDay,
      newSteamIdsWeek: newWeek,
      newSteamIdsMonth: newMonth,
      wakeAvgWeek: fmtMskHm(wakeWeek),
      wakeAvgMonth: fmtMskHm(wakeMonth),
      peakHourUnique: peak.peakHourUnique,
      peakHour: peak.peakHour,
      playerHours,
      avgSessionMin,
      busyHour,
      quietHour,
    },
    updatedAt: new Date().toISOString(),
  };

  memSet(cacheKey, payload);
  return payload;
}

async function countUniqueInRange(fromYmd: string, toYmd: string): Promise<number> {
  const { start } = mskDayBounds(fromYmd);
  const { end } = mskDayBounds(toYmd);
  const rows = await prisma.$queryRaw<{ c: bigint }[]>`
    SELECT COUNT(DISTINCT "steamId") AS c
    FROM "SquadServerSession"
    WHERE "serverKey" IN ('TPUB1','PB1','TPUB','PUBLIC')
      AND "joinedAt" < ${end}
      AND ( "leftAt" IS NULL OR "leftAt" > ${start} )
  `;
  return Number(rows[0]?.c || 0);
}

async function countNewInRange(fromYmd: string, toYmd: string): Promise<number> {
  const { start } = mskDayBounds(fromYmd);
  const { end } = mskDayBounds(toYmd);
  const rows = await prisma.$queryRaw<{ c: bigint }[]>`
    SELECT COUNT(*) AS c FROM (
      SELECT "steamId"
      FROM "SquadServerSession"
      WHERE "serverKey" IN ('TPUB1','PB1','TPUB','PUBLIC')
      GROUP BY "steamId"
      HAVING MIN("joinedAt") >= ${start} AND MIN("joinedAt") < ${end}
    ) t
  `;
  return Number(rows[0]?.c || 0);
}

/** Warm recent days (cron / first open). */
export async function warmPb1AnalyticsDays(daysBack = 14) {
  const today = mskYmd(new Date());
  for (let i = 0; i <= daysBack; i++) {
    await getDayRollup(addDaysYmd(today, -i));
  }
}
