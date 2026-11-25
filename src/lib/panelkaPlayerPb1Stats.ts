/**
 * Admin-only PB1 player card stats (panelka). Not for public profiles.
 */
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
    /** hours relative to Moscow, e.g. 0 = МСК, +2 = МСК+2 */
    offsetFromMsk: number | null;
    offsetLabel: string | null;
    ip: string | null;
    source: "geoip" | "none";
  };
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

async function favoriteKitBySteam(steamId: string): Promise<string | null> {
  const { from, to } = rollingMainRoleWindow();
  const bounds = mskRangeBoundsUtc(from, to);
  if (!bounds) return null;
  const keys = [...PUBLIC_SERVER_KEYS, "PUB", "TPUB", "TPUB1", "PB1"];
  const rows = await prisma.$queryRaw<
    { kit: string; sec: bigint }[]
  >`
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
    // split across MSK midnights
    let cursor = a;
    while (cursor < b) {
      const ymd = mskYmd(new Date(cursor));
      const [y, m, d] = ymd.split("-").map(Number);
      const nextMidnight = new Date(Date.UTC(y, m - 1, d + 1, -3, 0, 0)).getTime();
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

async function lookupGeoBySteam(steamId: string): Promise<{
  country: string | null;
  region: string | null;
  city: string | null;
  flag: string | null;
  offsetFromMsk: number | null;
  offsetLabel: string | null;
  ip: string | null;
  source: "geoip" | "none";
}> {
  const empty = {
    country: null,
    region: null,
    city: null,
    flag: null,
    offsetFromMsk: null,
    offsetLabel: null,
    ip: null,
    source: "none" as const,
  };
  try {
    const ipRes = (await runPanelka(["player-ip", steamId], 20000)) as {
      ok?: boolean;
      ip?: string;
    };
    const ip = String(ipRes?.ip || "").trim();
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return empty;
    // Free GeoIP (no key) — admin-only, low volume
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 6000);
    const res = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?lang=ru&fields=status,country,regionName,city,offset,query`,
      { signal: ac.signal, cache: "no-store" }
    ).finally(() => clearTimeout(timer));
    const data = (await res.json().catch(() => null)) as {
      status?: string;
      country?: string;
      regionName?: string;
      city?: string;
      offset?: number;
      query?: string;
    } | null;
    if (!data || data.status !== "success") {
      return { ...empty, ip, source: "none" };
    }
    const utcOffsetHours = Math.round((Number(data.offset) || 0) / 3600);
    const offsetFromMsk = utcOffsetHours - MSK_OFFSET_HOURS;
    return {
      country: data.country || null,
      region: data.regionName || null,
      city: data.city || null,
      flag: null,
      offsetFromMsk,
      offsetLabel: formatOffsetFromMsk(offsetFromMsk),
      ip,
      source: "geoip",
    };
  } catch {
    return empty;
  }
}

export async function buildPanelkaPlayerPb1Stats(opts: {
  steamId: string;
  nick?: string | null;
}): Promise<PanelkaPlayerPb1Stats | null> {
  if (!STEAM_RE.test(opts.steamId)) return null;
  const nick = String(opts.nick || "").trim();

  const [visits, kit, combat, location] = await Promise.all([
    buildVisitBars(opts.steamId, 90),
    favoriteKitBySteam(opts.steamId).catch(() => null),
    nick
      ? buildPlayerPublicCombatStats(nick, { steamId: opts.steamId }).catch(
          () => null
        )
      : Promise.resolve(null),
    lookupGeoBySteam(opts.steamId),
  ]);

  // Lifetime hours from all closed+open sessions (not only 90d)
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

  const visitMaxHours = Math.max(
    0.25,
    ...visits.bars.map((b) => b.hours)
  );

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
    location,
  };
}
