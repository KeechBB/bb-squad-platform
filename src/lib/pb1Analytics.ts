/**
 * PB1 analytics: concurrent online (not unique-per-hour).
 * Day = hours 0–23; week = days Mon–Sun; month = days of calendar month.
 * Staff = SUPER_ADMIN + PUBLIC_ADMIN + PUBLIC_MOD (Keech + паблик админ/мод).
 * Queue (yellow) from live RCON + light sample cache.
 */
import fs from "fs";
import path from "path";
import { prisma } from "@/lib/prisma";
import { runPanelka, type PanelkaServer } from "@/lib/panelkaRcon";

export const PB1_SERVER_KEYS = ["TPUB1", "PB1", "TPUB", "PUBLIC"] as const;

const STAFF_ROLES = ["SUPER_ADMIN", "PUBLIC_ADMIN", "PUBLIC_MOD"] as const;
const WAKE_MIN_CONCURRENT = 51;
const WAKE_FROM_HOUR_MSK = 8;
const SAMPLE_STEP_MS = 10 * 60_000;
const CACHE_DIR = path.join(process.cwd(), "data", "cache", "pb1-analytics");
const QUEUE_SAMPLES_PATH = path.join(CACHE_DIR, "queue-samples.jsonl");
const MEM_TTL_MS = 2 * 60_000;

export type Pb1Bar = {
  key: string;
  label: string;
  /** средний concurrent игроков (не staff) */
  players: number;
  /** средний concurrent staff */
  staff: number;
  /** средний размер очереди (если есть сэмплы) */
  queue: number;
  /** players + staff */
  online: number;
};

export type Pb1LiveNow = {
  online: number;
  players: number;
  staff: number;
  queue: number;
  map: string;
  layer: string;
  at: string;
};

export type Pb1AnalyticsScope = "day" | "week" | "month";

export type Pb1AnalyticsPayload = {
  scope: Pb1AnalyticsScope;
  key: string;
  label: string;
  range: { fromYmd: string; toYmd: string };
  bars: Pb1Bar[];
  live: Pb1LiveNow | null;
  /** календарь / пресеты для UI */
  dayChoices: string[];
  weekChoices: { key: string; label: string; fromYmd: string; toYmd: string }[];
  monthChoices: { key: string; label: string }[];
  stats: {
    uniqueSteamIdsDay: number;
    uniqueSteamIdsWeek: number;
    uniqueSteamIdsMonth: number;
    newSteamIdsDay: number;
    newSteamIdsWeek: number;
    newSteamIdsMonth: number;
    wakeAvgWeek: string | null;
    wakeAvgMonth: string | null;
    peakOnline: number;
    playerHours: number;
  };
  updatedAt: string;
};

type SessionLite = { steamId: string; joinedAt: Date; leftAt: Date | null };

type DayRollup = {
  ymd: string;
  hours: Pb1Bar[];
  avgOnline: number;
  avgPlayers: number;
  avgStaff: number;
  avgQueue: number;
  uniqueSteamIds: number;
  newSteamIds: number;
  peakOnline: number;
  playerHours: number;
  wakeMskMinutes: number | null;
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

export function mskYmd(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function mskDayBounds(ymd: string): { start: Date; end: Date } {
  const [y, m, d] = ymd.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, d, -3, 0, 0));
  const end = new Date(Date.UTC(y, m - 1, d + 1, -3, 0, 0));
  return { start, end };
}

function addDaysYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
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

export function weekBoundsFromYmd(ymd: string): { fromYmd: string; toYmd: string } {
  const [y, m, d] = ymd.split("-").map(Number);
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
  return { fromYmd, toYmd: addDaysYmd(fromYmd, 6) };
}

export function monthBounds(year: number, month: number) {
  const fromYmd = `${year}-${pad2(month)}-01`;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { fromYmd, toYmd: `${year}-${pad2(month)}-${pad2(last)}` };
}

function fmtMskHm(mins: number | null): string | null {
  if (mins == null || !Number.isFinite(mins)) return null;
  const m = Math.max(0, Math.min(24 * 60 - 1, Math.round(mins)));
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

function monthNameRu(month: number): string {
  return (
    [
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
    ][month] || String(month)
  );
}

function weekdayRu(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const noon = new Date(Date.UTC(y, m - 1, d, 9, 0, 0));
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    weekday: "short",
  }).format(noon);
}

function fmtDotShort(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return `${d}.${m}`;
}

async function loadStaffSteamSet(): Promise<Set<string>> {
  const cached = memGet<string[]>("staff-steams-v2");
  if (cached) return new Set(cached);
  const rows = await prisma.user.findMany({
    where: { role: { in: [...STAFF_ROLES] } },
    select: { steamId: true },
  });
  const ids = rows.map((r) => r.steamId).filter(Boolean);
  memSet("staff-steams-v2", ids);
  return new Set(ids);
}

async function loadFirstSeenMap(): Promise<Map<string, string>> {
  const cached = memGet<[string, string][]>("first-seen-v2");
  if (cached) return new Map(cached);
  const rows = await prisma.$queryRaw<{ steamId: string; firstAt: Date }[]>`
    SELECT "steamId", MIN("joinedAt") AS "firstAt"
    FROM "SquadServerSession"
    WHERE "serverKey" IN ('TPUB1','PB1','TPUB','PUBLIC')
    GROUP BY "steamId"`;
  const pairs: [string, string][] = rows.map((r) => [
    r.steamId,
    mskYmd(new Date(r.firstAt)),
  ]);
  memSet("first-seen-v2", pairs);
  return new Map(pairs);
}

async function loadSessionsForDay(ymd: string): Promise<SessionLite[]> {
  const { start, end } = mskDayBounds(ymd);
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
  const dayStart = start.getTime();
  const dayEnd = end.getTime();
  return rows
    .map((r) => ({
      steamId: r.steamId,
      joinedAt: r.joinedAt,
      leftAt: new Date(
        Math.min(
          r.leftAt ? r.leftAt.getTime() : Math.max(now, dayEnd),
          dayEnd + 6 * 3600_000
        )
      ),
    }))
    .filter((r) => {
      const a = r.joinedAt.getTime();
      const b = r.leftAt!.getTime();
      return a < dayEnd && b > dayStart;
    });
}

/** queue samples: {t:ms, queue:n} */
function readQueueSamples(dayStart: number, dayEnd: number): { t: number; queue: number }[] {
  try {
    if (!fs.existsSync(QUEUE_SAMPLES_PATH)) return [];
    const lines = fs.readFileSync(QUEUE_SAMPLES_PATH, "utf8").split(/\r?\n/);
    const out: { t: number; queue: number }[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const o = JSON.parse(line) as { t?: number; queue?: number };
        const t = Number(o.t) || 0;
        if (t >= dayStart && t < dayEnd) {
          out.push({ t, queue: Math.max(0, Number(o.queue) || 0) });
        }
      } catch {
        /* skip */
      }
    }
    return out;
  } catch {
    return [];
  }
}

function appendQueueSample(queue: number) {
  try {
    ensureCacheDir();
    const line = JSON.stringify({ t: Date.now(), queue: Math.max(0, queue) }) + "\n";
    fs.appendFileSync(QUEUE_SAMPLES_PATH, line);
  } catch {
    /* ignore */
  }
}

function concurrentAt(
  sessions: SessionLite[],
  staff: Set<string>,
  t: number
): { players: number; staff: number; online: number } {
  let players = 0;
  let st = 0;
  for (const s of sessions) {
    const a = s.joinedAt.getTime();
    const b = (s.leftAt || new Date()).getTime();
    if (a <= t && b > t) {
      if (staff.has(s.steamId)) st++;
      else players++;
    }
  }
  return { players, staff: st, online: players + st };
}

function avgQueueInWindow(
  samples: { t: number; queue: number }[],
  a: number,
  b: number
): number {
  const hit = samples.filter((s) => s.t >= a && s.t < b);
  if (!hit.length) return 0;
  return hit.reduce((s, x) => s + x.queue, 0) / hit.length;
}

function buildDayRollup(
  ymd: string,
  sessions: SessionLite[],
  staff: Set<string>,
  firstSeen: Map<string, string>,
  queueSamples: { t: number; queue: number }[]
): DayRollup {
  const { start, end } = mskDayBounds(ymd);
  const dayStart = start.getTime();
  const dayEnd = end.getTime();
  const now = Date.now();
  const sampleUntil = Math.min(dayEnd, Math.max(now, dayStart));

  const hours: Pb1Bar[] = [];
  const allSamples: { online: number; players: number; staff: number; queue: number }[] = [];
  let peakOnline = 0;
  let wakeMskMinutes: number | null = null;

  for (let hour = 0; hour < 24; hour++) {
    const h0 = dayStart + hour * 3600_000;
    const h1 = h0 + 3600_000;
    if (h0 >= sampleUntil && ymd === mskYmd()) {
      // future hour today
      hours.push({
        key: String(hour),
        label: pad2(hour),
        players: 0,
        staff: 0,
        queue: 0,
        online: 0,
      });
      continue;
    }
    const endSamp = Math.min(h1, sampleUntil);
    let sumP = 0;
    let sumS = 0;
    let sumO = 0;
    let n = 0;
    for (let t = h0; t < endSamp; t += SAMPLE_STEP_MS) {
      const c = concurrentAt(sessions, staff, t);
      sumP += c.players;
      sumS += c.staff;
      sumO += c.online;
      n++;
      if (c.online > peakOnline) peakOnline = c.online;
      if (
        wakeMskMinutes == null &&
        hour * 60 >= WAKE_FROM_HOUR_MSK * 60 &&
        c.online > WAKE_MIN_CONCURRENT - 1
      ) {
        wakeMskMinutes = Math.round((t - dayStart) / 60000);
      }
    }
    const queue = avgQueueInWindow(queueSamples, h0, h1);
    const players = n ? Math.round((sumP / n) * 10) / 10 : 0;
    const st = n ? Math.round((sumS / n) * 10) / 10 : 0;
    const online = n ? Math.round((sumO / n) * 10) / 10 : 0;
    if (n) allSamples.push({ online, players, staff: st, queue });
    hours.push({
      key: String(hour),
      label: pad2(hour),
      players,
      staff: st,
      queue: Math.round(queue * 10) / 10,
      online,
    });
  }

  const uniques = new Set(sessions.map((s) => s.steamId));
  let newSteamIds = 0;
  for (const sid of uniques) {
    if (firstSeen.get(sid) === ymd) newSteamIds++;
  }

  let playerHours = 0;
  for (const s of sessions) {
    const a = Math.max(s.joinedAt.getTime(), dayStart);
    const b = Math.min((s.leftAt || new Date()).getTime(), dayEnd);
    if (b > a) playerHours += (b - a) / 3600_000;
  }

  const avgOnline = allSamples.length
    ? allSamples.reduce((s, x) => s + x.online, 0) / allSamples.length
    : 0;
  const avgPlayers = allSamples.length
    ? allSamples.reduce((s, x) => s + x.players, 0) / allSamples.length
    : 0;
  const avgStaff = allSamples.length
    ? allSamples.reduce((s, x) => s + x.staff, 0) / allSamples.length
    : 0;
  const avgQueue = allSamples.length
    ? allSamples.reduce((s, x) => s + x.queue, 0) / allSamples.length
    : 0;

  return {
    ymd,
    hours,
    avgOnline: Math.round(avgOnline * 10) / 10,
    avgPlayers: Math.round(avgPlayers * 10) / 10,
    avgStaff: Math.round(avgStaff * 10) / 10,
    avgQueue: Math.round(avgQueue * 10) / 10,
    uniqueSteamIds: uniques.size,
    newSteamIds,
    peakOnline,
    playerHours: Math.round(playerHours * 10) / 10,
    wakeMskMinutes,
  };
}

async function getDayRollup(ymd: string): Promise<DayRollup> {
  const memKey = `day-v3:${ymd}`;
  const hit = memGet<DayRollup>(memKey);
  if (hit) return hit;

  ensureCacheDir();
  const today = mskYmd();
  const fp = path.join(CACHE_DIR, `day-v3-${ymd}.json`);
  if (ymd < today && fs.existsSync(fp)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(fp, "utf8")) as DayRollup;
      memSet(memKey, parsed);
      return parsed;
    } catch {
      /* rebuild */
    }
  }

  const { start, end } = mskDayBounds(ymd);
  const [sessions, staff, firstSeen] = await Promise.all([
    loadSessionsForDay(ymd),
    loadStaffSteamSet(),
    loadFirstSeenMap(),
  ]);
  const queueSamples = readQueueSamples(start.getTime(), end.getTime());
  const rollup = buildDayRollup(ymd, sessions, staff, firstSeen, queueSamples);
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

async function countUniqueInRange(fromYmd: string, toYmd: string): Promise<number> {
  const { start } = mskDayBounds(fromYmd);
  const { end } = mskDayBounds(toYmd);
  const rows = await prisma.$queryRaw<{ c: bigint }[]>`
    SELECT COUNT(DISTINCT "steamId") AS c
    FROM "SquadServerSession"
    WHERE "serverKey" IN ('TPUB1','PB1','TPUB','PUBLIC')
      AND "joinedAt" < ${end}
      AND ( "leftAt" IS NULL OR "leftAt" > ${start} )`;
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
    ) t`;
  return Number(rows[0]?.c || 0);
}

async function fetchLiveNow(): Promise<Pb1LiveNow | null> {
  try {
    const [statusData, playersData, staff] = await Promise.all([
      runPanelka(["status", "PB1"], 20000) as Promise<{
        ok?: boolean;
        servers?: PanelkaServer[];
        server?: PanelkaServer;
      }>,
      runPanelka(["players", "PB1"], 20000).catch(() => null) as Promise<{
        players?: { steamId?: string }[];
      } | null>,
      loadStaffSteamSet(),
    ]);
    const server =
      statusData.server ||
      (statusData.servers || []).find((s) => s.key === "PB1") ||
      (statusData.servers || [])[0];
    if (!server) return null;

    const roster = Array.isArray(playersData?.players) ? playersData!.players! : [];
    let staffN = 0;
    for (const p of roster) {
      const sid = String(p.steamId || "");
      if (sid && staff.has(sid)) staffN++;
    }
    let playersN: number;
    if (roster.length) {
      playersN = Math.max(0, roster.length - staffN);
    } else {
      const now = Date.now();
      const open = await prisma.squadServerSession.findMany({
        where: {
          serverKey: { in: [...PB1_SERVER_KEYS] },
          leftAt: null,
          joinedAt: { gte: new Date(now - 12 * 3600_000) },
        },
        select: { steamId: true },
      });
      staffN = open.filter((o) => staff.has(o.steamId)).length;
      playersN = Math.max(0, open.length - staffN);
      if (!open.length && server.players > 0) {
        playersN = server.players;
        staffN = 0;
      }
    }
    const queue = Math.max(0, Number(server.queue) || 0);
    appendQueueSample(queue);
    return {
      online: playersN + staffN,
      players: playersN,
      staff: staffN,
      queue,
      map: server.map || "",
      layer: server.layer || "",
      at: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function weeksInMonth(year: number, month: number, today: string) {
  const { fromYmd, toYmd } = monthBounds(year, month);
  const out: { key: string; label: string; fromYmd: string; toYmd: string }[] = [];
  // start from Monday on/before 1st
  let cur = weekBoundsFromYmd(fromYmd).fromYmd;
  while (cur <= toYmd) {
    const w = weekBoundsFromYmd(cur);
    // include week if intersects month
    if (w.toYmd >= fromYmd && w.fromYmd <= toYmd) {
      const clipFrom = w.fromYmd < fromYmd ? fromYmd : w.fromYmd;
      const clipTo = w.toYmd > toYmd ? toYmd : w.toYmd;
      if (clipFrom <= today) {
        out.push({
          key: w.fromYmd,
          label: `${fmtDotShort(clipFrom)}–${fmtDotShort(clipTo)}`,
          fromYmd: w.fromYmd,
          toYmd: w.toYmd,
        });
      }
    }
    cur = addDaysYmd(w.toYmd, 1);
    if (out.length > 8) break;
  }
  return out;
}

function dayChoicesInMonth(year: number, month: number, today: string): string[] {
  const { fromYmd, toYmd } = monthBounds(year, month);
  return daysInclusive(fromYmd, toYmd <= today ? toYmd : today);
}

function monthChoices(year: number, today: string) {
  const maxMonth =
    Number(today.slice(0, 4)) === year ? Number(today.slice(5, 7)) : 12;
  const out: { key: string; label: string }[] = [];
  for (let m = 1; m <= maxMonth; m++) {
    out.push({ key: `${year}-${pad2(m)}`, label: monthNameRu(m) });
  }
  return out;
}

function avgWake(days: DayRollup[]): number | null {
  const vals = days
    .map((d) => d.wakeMskMinutes)
    .filter((v): v is number => v != null);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export async function buildPb1Analytics(opts: {
  scope: Pb1AnalyticsScope;
  key: string;
}): Promise<Pb1AnalyticsPayload> {
  const scope = opts.scope;
  const today = mskYmd();
  let key = String(opts.key || "").trim();

  let fromYmd = today;
  let toYmd = today;
  let label = today;
  const yearNow = Number(today.slice(0, 4));
  const monthNow = Number(today.slice(5, 7));

  if (scope === "day") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) key = today;
    fromYmd = key;
    toYmd = key;
    label = `${fmtDotShort(key)}.${key.slice(0, 4)}`;
  } else if (scope === "week") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) key = weekBoundsFromYmd(today).fromYmd;
    const w = weekBoundsFromYmd(key);
    fromYmd = w.fromYmd;
    toYmd = w.toYmd > today ? today : w.toYmd;
    label = `${fmtDotShort(w.fromYmd)}–${fmtDotShort(w.toYmd)}`;
    key = w.fromYmd;
  } else {
    if (!/^\d{4}-\d{2}$/.test(key)) key = today.slice(0, 7);
    const [y, m] = key.split("-").map(Number);
    const b = monthBounds(y, m);
    fromYmd = b.fromYmd;
    toYmd = b.toYmd > today ? today : b.toYmd;
    label = `${monthNameRu(m)} ${y}`;
  }

  const ymds = daysInclusive(fromYmd, scope === "day" ? fromYmd : toYmd);
  const rollups: DayRollup[] = [];
  const CONC = 4;
  for (let i = 0; i < ymds.length; i += CONC) {
    const chunk = ymds.slice(i, i + CONC);
    rollups.push(...(await Promise.all(chunk.map((d) => getDayRollup(d)))));
  }

  let bars: Pb1Bar[] = [];
  if (scope === "day") {
    bars = rollups[0]?.hours || [];
  } else if (scope === "week") {
    // full Mon–Sun of selected week (even if future days empty)
    const w = weekBoundsFromYmd(key);
    const allDays = daysInclusive(w.fromYmd, w.toYmd);
    const byYmd = new Map(rollups.map((r) => [r.ymd, r]));
    bars = allDays.map((ymd) => {
      const r = byYmd.get(ymd);
      const future = ymd > today;
      return {
        key: ymd,
        label: `${weekdayRu(ymd)} ${fmtDotShort(ymd)}`,
        players: future ? 0 : r?.avgPlayers || 0,
        staff: future ? 0 : r?.avgStaff || 0,
        queue: future ? 0 : r?.avgQueue || 0,
        online: future ? 0 : r?.avgOnline || 0,
      };
    });
  } else {
    const [y, m] = key.split("-").map(Number);
    const b = monthBounds(y, m);
    const allDays = daysInclusive(b.fromYmd, b.toYmd);
    const byYmd = new Map(rollups.map((r) => [r.ymd, r]));
    bars = allDays.map((ymd) => {
      const r = byYmd.get(ymd);
      const future = ymd > today;
      return {
        key: ymd,
        label: ymd.slice(8, 10),
        players: future ? 0 : r?.avgPlayers || 0,
        staff: future ? 0 : r?.avgStaff || 0,
        queue: future ? 0 : r?.avgQueue || 0,
        online: future ? 0 : r?.avgOnline || 0,
      };
    });
  }

  const live =
    scope === "day" && fromYmd === today ? await fetchLiveNow() : null;

  // If viewing today, patch current hour with live concurrent
  if (live && scope === "day" && fromYmd === today) {
    const hour = Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Moscow",
        hour: "2-digit",
        hourCycle: "h23",
      }).format(new Date())
    );
    const bar = bars.find((b) => Number(b.key) === hour);
    if (bar) {
      bar.players = live.players;
      bar.staff = live.staff;
      bar.queue = live.queue;
      bar.online = live.online;
    }
  }

  const weekB = weekBoundsFromYmd(scope === "week" ? key : toYmd);
  const [ay, am] = toYmd.split("-").map(Number);
  const monthB = monthBounds(ay, am);

  const weekRollups = await Promise.all(
    daysInclusive(
      weekB.fromYmd,
      weekB.toYmd > today ? today : weekB.toYmd
    ).map((d) => getDayRollup(d))
  );
  const monthRollups = await Promise.all(
    daysInclusive(
      monthB.fromYmd,
      monthB.toYmd > today ? today : monthB.toYmd
    ).map((d) => getDayRollup(d))
  );

  const [
    uniqueDay,
    uniqueWeek,
    uniqueMonth,
    newDay,
    newWeek,
    newMonth,
  ] = await Promise.all([
    countUniqueInRange(toYmd, toYmd),
    countUniqueInRange(
      weekB.fromYmd,
      weekB.toYmd > today ? today : weekB.toYmd
    ),
    countUniqueInRange(
      monthB.fromYmd,
      monthB.toYmd > today ? today : monthB.toYmd
    ),
    countNewInRange(toYmd, toYmd),
    countNewInRange(weekB.fromYmd, weekB.toYmd > today ? today : weekB.toYmd),
    countNewInRange(
      monthB.fromYmd,
      monthB.toYmd > today ? today : monthB.toYmd
    ),
  ]);

  const peakOnline = Math.max(
    0,
    ...rollups.map((r) => r.peakOnline),
    live?.online || 0
  );
  const playerHours =
    Math.round(rollups.reduce((s, r) => s + r.playerHours, 0) * 10) / 10;

  const uiYear = scope === "month" ? Number(key.slice(0, 4)) : yearNow;
  const uiMonth = scope === "month" ? Number(key.slice(5, 7)) : monthNow;

  return {
    scope,
    key,
    label,
    range: { fromYmd, toYmd },
    bars,
    live,
    dayChoices: dayChoicesInMonth(uiYear, uiMonth, today),
    weekChoices: weeksInMonth(yearNow, monthNow, today),
    monthChoices: monthChoices(uiYear || yearNow, today),
    stats: {
      uniqueSteamIdsDay: uniqueDay,
      uniqueSteamIdsWeek: uniqueWeek,
      uniqueSteamIdsMonth: uniqueMonth,
      newSteamIdsDay: newDay,
      newSteamIdsWeek: newWeek,
      newSteamIdsMonth: newMonth,
      wakeAvgWeek: fmtMskHm(avgWake(weekRollups)),
      wakeAvgMonth: fmtMskHm(avgWake(monthRollups)),
      peakOnline,
      playerHours,
    },
    updatedAt: new Date().toISOString(),
  };
}
