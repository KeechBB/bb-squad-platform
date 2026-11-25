/**
 * Admin-only PB1 player card stats (panelka).
 * Disk cache: data/cache/panelka-pb1-stats/<steamId>.json — warm cron fills it.
 */
import fs from "fs";
import path from "path";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildPlayerPublicCombatStats } from "@/lib/publicCombat";
import { rollingMainRoleWindow } from "@/lib/mainRoleWindow";
import { mskRangeBoundsUtc } from "@/lib/squadRoles";
import { canonKitName } from "@/lib/squadKits";
import { PUBLIC_SERVER_KEYS } from "@/lib/squadServers";
import { runPanelka } from "@/lib/panelkaRcon";

const PB1_KEYS = ["TPUB1", "PB1", "TPUB", "PUBLIC"] as const;
const STEAM_RE = /^7656\d{13}$/;
const MSK_OFFSET_HOURS = 3;
const CACHE_DIR = path.join(process.cwd(), "data", "cache", "panelka-pb1-stats");
const INDEX_PATH = path.join(CACHE_DIR, "_index.json");
const IP_MAP_PATH = path.join(
  process.cwd(),
  "data",
  "cache",
  "panelka-player-ips.json"
);
/** Serve cache as fresh for this long. */
const CACHE_FRESH_MS = 6 * 3600_000;
/** Still serve stale cache while refreshing in background. */
const CACHE_STALE_OK_MS = 48 * 3600_000;
/** Refresh plaza IP map from game host at most this often. */
const IP_MAP_FRESH_MS = 30 * 60_000;

export type Pb1VisitBar = {
  ymd: string;
  label: string;
  minutes: number;
  hours: number;
};

export type PanelkaPlayerPb1Stats = {
  hoursLabel: string;
  publicMinutes: number;
  sessions: number;
  kd: number | null;
  winsPct: number | null;
  matches: number;
  favoriteKit: string | null;
  visitDays: number;
  visitBars: Pb1VisitBar[];
  visitMaxHours: number;
  location: {
    country: string | null;
    region: string | null;
    city: string | null;
    flag: string | null;
    offsetFromMsk: number | null;
    offsetLabel: string | null;
    ip: string | null;
    source: "geoip" | "none";
  };
};

export type PanelkaPb1StatsCacheEntry = {
  steamId: string;
  nick: string | null;
  updatedAt: string;
  stats: PanelkaPlayerPb1Stats;
};

type IndexFile = {
  cursor: string;
  lastWarmAt: string | null;
  warmed: number;
};

function pad2(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

function mskYmd(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function addDaysYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

function formatHours(totalMinutes: number): string {
  const m = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h <= 0) return `${mm} мин`;
  return `${h} ч ${pad2(mm)} мин`;
}

function formatOffsetFromMsk(offsetHours: number): string {
  if (offsetHours === 0) return "МСК";
  const sign = offsetHours > 0 ? "+" : "−";
  return `МСК${sign}${Math.abs(offsetHours)}`;
}

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function cachePath(steamId: string) {
  return path.join(CACHE_DIR, `${steamId}.json`);
}

export function readPb1StatsCache(
  steamId: string
): PanelkaPb1StatsCacheEntry | null {
  try {
    const fp = cachePath(steamId);
    if (!fs.existsSync(fp)) return null;
    const parsed = JSON.parse(
      fs.readFileSync(fp, "utf8")
    ) as PanelkaPb1StatsCacheEntry;
    if (!parsed?.stats || parsed.steamId !== steamId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writePb1StatsCache(
  entry: PanelkaPb1StatsCacheEntry
): void {
  ensureCacheDir();
  const tmp = cachePath(entry.steamId) + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(entry));
  fs.renameSync(tmp, cachePath(entry.steamId));
}

function readIndex(): IndexFile {
  try {
    if (!fs.existsSync(INDEX_PATH)) {
      return { cursor: "", lastWarmAt: null, warmed: 0 };
    }
    return JSON.parse(fs.readFileSync(INDEX_PATH, "utf8")) as IndexFile;
  } catch {
    return { cursor: "", lastWarmAt: null, warmed: 0 };
  }
}

function writeIndex(idx: IndexFile) {
  ensureCacheDir();
  fs.writeFileSync(INDEX_PATH, JSON.stringify(idx, null, 2));
}

async function favoriteKitBySteam(steamId: string): Promise<string | null> {
  const { from, to } = rollingMainRoleWindow();
  const bounds = mskRangeBoundsUtc(from, to);
  if (!bounds) return null;
  const keys = [...PUBLIC_SERVER_KEYS, "PUB", "TPUB", "TPUB1", "PB1"];
  const rows = await prisma.$queryRaw<{ kit: string; sec: bigint }[]>`
    WITH ev AS (
      SELECT
        kit,
        "spawnedAt",
        LEAD("spawnedAt") OVER (
          PARTITION BY "steamId", "serverKey"
          ORDER BY "spawnedAt", "id"
        ) AS nxt
      FROM "SquadRoleEvent"
      WHERE "serverKey" IN (${Prisma.join(keys)})
        AND "steamId" = ${steamId}
        AND "spawnedAt" >= ${bounds.gte}
        AND "spawnedAt" < ${bounds.lt}
    )
    SELECT kit,
      SUM(LEAST(
        2700,
        GREATEST(0, EXTRACT(EPOCH FROM (
          LEAST(
            COALESCE(nxt, "spawnedAt" + INTERVAL '15 minutes'),
            "spawnedAt" + INTERVAL '45 minutes'
          ) - "spawnedAt"
        )))
      ))::bigint AS sec
    FROM ev
    GROUP BY kit
    ORDER BY sec DESC
    LIMIT 8
  `;
  let best = "";
  let bestSec = -1;
  for (const row of rows) {
    const kit = String(canonKitName(row.kit) || row.kit || "").trim();
    const sec = Number(row.sec) || 0;
    if (!kit || sec <= 0) continue;
    if (sec > bestSec) {
      best = kit;
      bestSec = sec;
    }
  }
  return best || null;
}

async function buildVisitBars(
  steamId: string,
  days = 90
): Promise<{ bars: Pb1VisitBar[]; totalMinutes: number; sessions: number }> {
  const today = mskYmd();
  const fromYmd = addDaysYmd(today, -(days - 1));
  const [fy, fm, fd] = fromYmd.split("-").map(Number);
  const fromUtc = new Date(Date.UTC(fy, fm - 1, fd, -3, 0, 0));

  const sessions = await prisma.squadServerSession.findMany({
    where: {
      steamId,
      serverKey: { in: [...PB1_KEYS] },
      joinedAt: { gte: fromUtc },
    },
    select: { joinedAt: true, leftAt: true },
    orderBy: { joinedAt: "asc" },
    take: 8000,
  });

  const byDay = new Map<string, number>();
  let totalMinutes = 0;
  const now = Date.now();
  for (const s of sessions) {
    const a = s.joinedAt.getTime();
    const b = s.leftAt ? s.leftAt.getTime() : Math.max(now, a);
    if (b <= a) continue;
    let cursor = a;
    while (cursor < b) {
      const ymd = mskYmd(new Date(cursor));
      const [y, m, d] = ymd.split("-").map(Number);
      const nextMidnight = new Date(
        Date.UTC(y, m - 1, d + 1, -3, 0, 0)
      ).getTime();
      const end = Math.min(b, nextMidnight);
      const mins = (end - cursor) / 60000;
      byDay.set(ymd, (byDay.get(ymd) || 0) + mins);
      totalMinutes += mins;
      cursor = end;
    }
  }

  const bars: Pb1VisitBar[] = [];
  for (let i = 0; i < days; i++) {
    const ymd = addDaysYmd(fromYmd, i);
    const minutes = Math.round((byDay.get(ymd) || 0) * 10) / 10;
    bars.push({
      ymd,
      label: `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}`,
      minutes,
      hours: Math.round((minutes / 60) * 100) / 100,
    });
  }
  return {
    bars,
    totalMinutes: Math.round(totalMinutes),
    sessions: sessions.length,
  };
}

async function geoFromIp(ip: string): Promise<PanelkaPlayerPb1Stats["location"]> {
  const empty: PanelkaPlayerPb1Stats["location"] = {
    country: null,
    region: null,
    city: null,
    flag: null,
    offsetFromMsk: null,
    offsetLabel: null,
    ip,
    source: "none",
  };
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    return { ...empty, ip: null };
  }
  // ip-api.com is often blocked from VPS — use ipwho.is, then geojs.io
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 7000);
    const res = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, {
      signal: ac.signal,
      cache: "no-store",
    }).finally(() => clearTimeout(timer));
    const data = (await res.json().catch(() => null)) as {
      success?: boolean;
      country?: string;
      region?: string;
      city?: string;
      timezone?: { offset?: number; utc?: string; id?: string };
    } | null;
    if (data?.success) {
      const utcOffsetHours = Math.round((Number(data.timezone?.offset) || 0) / 3600);
      const offsetFromMsk = utcOffsetHours - MSK_OFFSET_HOURS;
      return {
        country: data.country || null,
        region: data.region || null,
        city: data.city || null,
        flag: null,
        offsetFromMsk,
        offsetLabel: formatOffsetFromMsk(offsetFromMsk),
        ip,
        source: "geoip",
      };
    }
  } catch {
    /* try fallback */
  }
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 7000);
    const res = await fetch(
      `https://get.geojs.io/v1/ip/geo/${encodeURIComponent(ip)}.json`,
      { signal: ac.signal, cache: "no-store" }
    ).finally(() => clearTimeout(timer));
    const data = (await res.json().catch(() => null)) as {
      country?: string;
      region?: string;
      city?: string;
      timezone?: string;
    } | null;
    if (!data?.country) return empty;
    // Approximate offset via Intl if timezone id present
    let offsetFromMsk: number | null = null;
    if (data.timezone) {
      try {
        const fmt = new Intl.DateTimeFormat("en-US", {
          timeZone: data.timezone,
          timeZoneName: "shortOffset",
        });
        const parts = fmt.formatToParts(new Date());
        const raw = parts.find((p) => p.type === "timeZoneName")?.value || "";
        const m = raw.match(/GMT([+-]\d+)(?::(\d+))?/i);
        if (m) {
          const h = Number(m[1]);
          offsetFromMsk = h - MSK_OFFSET_HOURS;
        }
      } catch {
        offsetFromMsk = null;
      }
    }
    return {
      country: data.country || null,
      region: data.region || null,
      city: data.city || null,
      flag: null,
      offsetFromMsk,
      offsetLabel:
        offsetFromMsk != null ? formatOffsetFromMsk(offsetFromMsk) : null,
      ip,
      source: "geoip",
    };
  } catch {
    return empty;
  }
}

function readPlazaIpMap(): Record<string, string> {
  try {
    if (!fs.existsSync(IP_MAP_PATH)) return {};
    const parsed = JSON.parse(fs.readFileSync(IP_MAP_PATH, "utf8")) as {
      ips?: Record<string, string>;
    };
    return parsed?.ips && typeof parsed.ips === "object" ? parsed.ips : {};
  } catch {
    return {};
  }
}

function writePlazaIpMap(ips: Record<string, string>) {
  ensureCacheDir();
  const dir = path.dirname(IP_MAP_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = IP_MAP_PATH + ".tmp";
  fs.writeFileSync(
    tmp,
    JSON.stringify({
      updatedAt: new Date().toISOString(),
      count: Object.keys(ips).length,
      ips,
    })
  );
  fs.renameSync(tmp, IP_MAP_PATH);
}

/** Pull steam→IP map from game-host PostLogin scan (cached on plaza). */
export async function refreshPanelkaPlayerIpMap(opts?: {
  force?: boolean;
}): Promise<{ ok: boolean; count: number; fromCache: boolean }> {
  try {
    if (!opts?.force && fs.existsSync(IP_MAP_PATH)) {
      const age = Date.now() - fs.statSync(IP_MAP_PATH).mtimeMs;
      if (Number.isFinite(age) && age < IP_MAP_FRESH_MS) {
        return {
          ok: true,
          count: Object.keys(readPlazaIpMap()).length,
          fromCache: true,
        };
      }
    }
    const res = (await runPanelka(["player-ips-rebuild"], 90000)) as {
      ok?: boolean;
      count?: number;
      ips?: Record<string, string>;
    };
    const ips =
      res?.ips && typeof res.ips === "object"
        ? Object.fromEntries(
            Object.entries(res.ips).filter(
              ([sid, ip]) =>
                STEAM_RE.test(sid) && /^\d{1,3}(\.\d{1,3}){3}$/.test(String(ip))
            )
          )
        : {};
    writePlazaIpMap(ips);
    return { ok: Boolean(res?.ok), count: Object.keys(ips).length, fromCache: false };
  } catch {
    return {
      ok: false,
      count: Object.keys(readPlazaIpMap()).length,
      fromCache: true,
    };
  }
}

async function lookupGeoBySteam(
  steamId: string,
  prevIp?: string | null,
  knownIp?: string | null
): Promise<PanelkaPlayerPb1Stats["location"]> {
  const empty: PanelkaPlayerPb1Stats["location"] = {
    country: null,
    region: null,
    city: null,
    flag: null,
    offsetFromMsk: null,
    offsetLabel: null,
    ip: null,
    source: "none",
  };
  let ip = String(knownIp || "").trim();
  if (!ip) {
    const mapIp = readPlazaIpMap()[steamId];
    if (mapIp) ip = mapIp;
  }
  if (!ip) {
    try {
      const ipRes = (await runPanelka(["player-ip", steamId], 20000)) as {
        ok?: boolean;
        ip?: string;
      };
      ip = String(ipRes?.ip || "").trim();
    } catch {
      /* no live IP */
    }
  }
  if (!ip && prevIp) ip = prevIp;
  if (!ip) return empty;
  return geoFromIp(ip);
}

/** Full rebuild (DB + optional live IP). */
export async function buildPanelkaPlayerPb1Stats(opts: {
  steamId: string;
  nick?: string | null;
  /** Skip live IP RCON (faster warm). Still uses map / previous cached IP for geo. */
  skipLiveIp?: boolean;
  prevLocation?: PanelkaPlayerPb1Stats["location"] | null;
  /** Known IP from plaza map (warm path). */
  knownIp?: string | null;
}): Promise<PanelkaPlayerPb1Stats | null> {
  if (!STEAM_RE.test(opts.steamId)) return null;
  const nick = String(opts.nick || "").trim();
  const prevLoc = opts.prevLocation || null;
  const mapIp =
    opts.knownIp ||
    readPlazaIpMap()[opts.steamId] ||
    prevLoc?.ip ||
    null;

  const locationPromise = opts.skipLiveIp
    ? mapIp
      ? geoFromIp(mapIp)
      : Promise.resolve(
          prevLoc || {
            country: null,
            region: null,
            city: null,
            flag: null,
            offsetFromMsk: null,
            offsetLabel: null,
            ip: null,
            source: "none" as const,
          }
        )
    : lookupGeoBySteam(opts.steamId, prevLoc?.ip || null, mapIp);

  const [visits, kit, combat, location] = await Promise.all([
    buildVisitBars(opts.steamId, 90),
    favoriteKitBySteam(opts.steamId).catch(() => null),
    nick
      ? buildPlayerPublicCombatStats(nick, { steamId: opts.steamId }).catch(
          () => null
        )
      : Promise.resolve(null),
    locationPromise,
  ]);

  // Keep previous geo if live lookup failed
  const loc =
    location.source === "geoip"
      ? location
      : prevLoc?.source === "geoip"
        ? prevLoc
        : location;

  const life = await prisma.squadServerSession.findMany({
    where: {
      steamId: opts.steamId,
      serverKey: { in: [...PB1_KEYS] },
    },
    select: { joinedAt: true, leftAt: true },
    take: 12000,
  });
  let lifeMinutes = 0;
  const now = Date.now();
  for (const s of life) {
    const a = s.joinedAt.getTime();
    const b = s.leftAt ? s.leftAt.getTime() : Math.max(now, a);
    if (b > a) lifeMinutes += (b - a) / 60000;
  }

  const visitMaxHours = Math.max(0.25, ...visits.bars.map((b) => b.hours));

  return {
    hoursLabel: formatHours(lifeMinutes),
    publicMinutes: Math.round(lifeMinutes),
    sessions: life.length,
    kd: combat && combat.matches > 0 ? combat.kd : null,
    winsPct: combat && combat.matches > 0 ? combat.winrate : null,
    matches: combat?.matches || 0,
    favoriteKit: kit,
    visitDays: visits.bars.filter((b) => b.minutes > 0).length,
    visitBars: visits.bars,
    visitMaxHours,
    location: loc,
  };
}

export async function rebuildAndCachePb1Stats(opts: {
  steamId: string;
  nick?: string | null;
  skipLiveIp?: boolean;
  knownIp?: string | null;
}): Promise<PanelkaPb1StatsCacheEntry | null> {
  const prev = readPb1StatsCache(opts.steamId);
  const nick =
    opts.nick ||
    prev?.nick ||
    (
      await prisma.user.findFirst({
        where: { steamId: opts.steamId },
        select: { nick: true, steamName: true },
      })
    )?.nick ||
    (
      await prisma.user.findFirst({
        where: { steamId: opts.steamId },
        select: { steamName: true },
      })
    )?.steamName ||
    null;

  const stats = await buildPanelkaPlayerPb1Stats({
    steamId: opts.steamId,
    nick,
    skipLiveIp: opts.skipLiveIp,
    prevLocation: prev?.stats.location || null,
    knownIp: opts.knownIp,
  });
  if (!stats) return null;
  const entry: PanelkaPb1StatsCacheEntry = {
    steamId: opts.steamId,
    nick: nick || null,
    updatedAt: new Date().toISOString(),
    stats,
  };
  writePb1StatsCache(entry);
  return entry;
}

/**
 * Card path: return cache immediately; refresh in background if stale.
 * Only blocks on miss / very old cache.
 */
export async function getPanelkaPlayerPb1Stats(opts: {
  steamId: string;
  nick?: string | null;
}): Promise<{
  stats: PanelkaPlayerPb1Stats | null;
  fromCache: boolean;
  updatedAt: string | null;
}> {
  if (!STEAM_RE.test(opts.steamId)) {
    return { stats: null, fromCache: false, updatedAt: null };
  }
  const cached = readPb1StatsCache(opts.steamId);
  const age = cached ? Date.now() - Date.parse(cached.updatedAt) : Infinity;

  if (cached && Number.isFinite(age) && age < CACHE_FRESH_MS) {
    return {
      stats: cached.stats,
      fromCache: true,
      updatedAt: cached.updatedAt,
    };
  }

  if (cached && Number.isFinite(age) && age < CACHE_STALE_OK_MS) {
    // Stale but usable — refresh async
    void rebuildAndCachePb1Stats({
      steamId: opts.steamId,
      nick: opts.nick || cached.nick,
      skipLiveIp: false,
    }).catch(() => null);
    return {
      stats: cached.stats,
      fromCache: true,
      updatedAt: cached.updatedAt,
    };
  }

  // Miss or too old — build now
  const entry = await rebuildAndCachePb1Stats({
    steamId: opts.steamId,
    nick: opts.nick,
    skipLiveIp: false,
  });
  return {
    stats: entry?.stats || null,
    fromCache: false,
    updatedAt: entry?.updatedAt || null,
  };
}

/** Steam IDs with PB1 sessions in the last N days (for warm). */
export async function listRecentPb1SteamIds(
  days = 45,
  limit = 5000
): Promise<string[]> {
  const since = new Date(Date.now() - days * 86400_000);
  const rows = await prisma.$queryRaw<{ steamId: string }[]>`
    SELECT DISTINCT "steamId"
    FROM "SquadServerSession"
    WHERE "serverKey" IN ('TPUB1','PB1','TPUB','PUBLIC')
      AND "joinedAt" >= ${since}
      AND "steamId" ~ '^7656[0-9]{13}$'
    ORDER BY "steamId"
    LIMIT ${limit}
  `;
  return rows.map((r) => r.steamId).filter((s) => STEAM_RE.test(s));
}

/**
 * Warm batch: rebuild next `limit` players after cursor.
 * skipLiveIp=true keeps warm fast; geo from plaza IP map (PostLogin).
 */
export async function warmPanelkaPb1StatsBatch(opts?: {
  limit?: number;
  skipLiveIp?: boolean;
}): Promise<{
  ok: boolean;
  processed: number;
  okCount: number;
  failCount: number;
  cursor: string;
  totalRecent: number;
  ipMapCount: number;
  geoPatched: number;
}> {
  const limit = Math.max(1, Math.min(120, opts?.limit ?? 40));
  const skipLiveIp = opts?.skipLiveIp !== false;
  const ipRefresh = await refreshPanelkaPlayerIpMap().catch(() => ({
    ok: false,
    count: Object.keys(readPlazaIpMap()).length,
    fromCache: true,
  }));
  const ipMap = readPlazaIpMap();
  // Patch geo into already-cached players that still have source=none
  let geoPatched = 0;
  // ip-api free limit ~45/min — patch a modest batch each warm
  for (const steamId of Object.keys(ipMap).slice(0, 35)) {
    const cached = readPb1StatsCache(steamId);
    if (!cached || cached.stats.location?.source === "geoip") continue;
    const ip = ipMap[steamId];
    if (!ip) continue;
    try {
      const loc = await geoFromIp(ip);
      if (loc.source !== "geoip") continue;
      writePb1StatsCache({
        ...cached,
        updatedAt: new Date().toISOString(),
        stats: { ...cached.stats, location: loc },
      });
      geoPatched += 1;
    } catch {
      /* ignore */
    }
  }
  const ids = await listRecentPb1SteamIds(45, 8000);
  const idx = readIndex();
  let start = 0;
  if (idx.cursor) {
    const i = ids.findIndex((s) => s > idx.cursor);
    start = i >= 0 ? i : 0;
  }
  const slice = ids.slice(start, start + limit);
  let okCount = 0;
  let failCount = 0;
  for (const steamId of slice) {
    try {
      const user = await prisma.user.findFirst({
        where: { steamId },
        select: { nick: true, steamName: true },
      });
      const nick = user?.nick || user?.steamName || null;
      const entry = await rebuildAndCachePb1Stats({
        steamId,
        nick,
        skipLiveIp,
        knownIp: ipMap[steamId] || null,
      });
      if (entry) okCount += 1;
      else failCount += 1;
    } catch {
      failCount += 1;
    }
  }
  const nextCursor = slice.length ? slice[slice.length - 1] : "";
  const wrapped = start + slice.length >= ids.length;
  writeIndex({
    cursor: wrapped ? "" : nextCursor,
    lastWarmAt: new Date().toISOString(),
    warmed: (idx.warmed || 0) + okCount,
  });
  return {
    ok: failCount === 0,
    processed: slice.length,
    okCount,
    failCount,
    cursor: wrapped ? "" : nextCursor,
    totalRecent: ids.length,
    ipMapCount: ipRefresh.count || Object.keys(ipMap).length,
    geoPatched,
  };
}

export function listCachedPb1SteamIds(limit = 500): string[] {
  ensureCacheDir();
  try {
    return fs
      .readdirSync(CACHE_DIR)
      .filter((f) => /^7656\d{13}\.json$/.test(f))
      .slice(0, limit)
      .map((f) => f.replace(/\.json$/, ""));
  } catch {
    return [];
  }
}

/** Compare cache vs fresh rebuild for verification. */
export async function verifyPb1StatsSample(opts?: {
  sample?: number;
}): Promise<{
  ok: boolean;
  checked: number;
  mismatches: {
    steamId: string;
    field: string;
    cached: unknown;
    fresh: unknown;
  }[];
}> {
  const sample = Math.max(1, Math.min(40, opts?.sample ?? 12));
  const ids = listCachedPb1SteamIds(400);
  // deterministic-ish sample: every Nth
  const step = Math.max(1, Math.floor(ids.length / sample));
  const pick = ids.filter((_, i) => i % step === 0).slice(0, sample);
  const mismatches: {
    steamId: string;
    field: string;
    cached: unknown;
    fresh: unknown;
  }[] = [];

  for (const steamId of pick) {
    const cached = readPb1StatsCache(steamId);
    if (!cached) continue;
    const fresh = await buildPanelkaPlayerPb1Stats({
      steamId,
      nick: cached.nick,
      skipLiveIp: true,
      prevLocation: cached.stats.location,
    });
    if (!fresh) {
      mismatches.push({
        steamId,
        field: "build",
        cached: "ok",
        fresh: null,
      });
      continue;
    }
    const c = cached.stats;
    const minsTol = Math.max(5, Math.round(c.publicMinutes * 0.03));
    if (Math.abs(c.publicMinutes - fresh.publicMinutes) > minsTol) {
      mismatches.push({
        steamId,
        field: "publicMinutes",
        cached: c.publicMinutes,
        fresh: fresh.publicMinutes,
      });
    }
    if (Math.abs(c.sessions - fresh.sessions) > 2) {
      mismatches.push({
        steamId,
        field: "sessions",
        cached: c.sessions,
        fresh: fresh.sessions,
      });
    }
    if (c.kd != null && fresh.kd != null && Math.abs(c.kd - fresh.kd) > 0.05) {
      mismatches.push({
        steamId,
        field: "kd",
        cached: c.kd,
        fresh: fresh.kd,
      });
    }
    if ((c.favoriteKit || "") !== (fresh.favoriteKit || "")) {
      // kit window rolls — soft warn only if both non-empty and different
      if (c.favoriteKit && fresh.favoriteKit) {
        mismatches.push({
          steamId,
          field: "favoriteKit",
          cached: c.favoriteKit,
          fresh: fresh.favoriteKit,
        });
      }
    }
  }

  return {
    ok: mismatches.length === 0,
    checked: pick.length,
    mismatches,
  };
}
