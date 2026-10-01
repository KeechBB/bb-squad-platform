import {
  buildPlayerTrainCombatStats,
  buildPlayerTrainMatchHistory,
  lookupPlayerTrainPwr,
  type PlayerTrainCombatStats,
  type TrainMatchHistoryRow,
} from "@/lib/homeTrainPwr";
import {
  buildPlayerCwMatchHistory,
  type CwMatchHistoryRow,
} from "@/lib/homeCwPwr";
import { buildPlayerKvStats, type PlayerKvStats } from "@/lib/kvStats";
import { kitsForUser } from "@/lib/squadRoles";
import type { KitPctRow } from "@/lib/squadKits";
import {
  bonesForUser,
  zonePctFromBones,
  type HitBoneCounts,
  type HitZonePct,
} from "@/lib/squadHits";
import {
  listRpTrainingMatches,
  playerRpMatchBreakdown,
  type RpMatchListItem,
  type RpPlayerMatch,
} from "@/lib/trainRp";
import { prisma } from "@/lib/prisma";

export type { RpMatchListItem };

export type CompareMatchCombat = {
  kills: number;
  deaths: number;
  res: number;
  nok: number;
  dmg: number;
  kd: number;
};

export type CompareMatchBundle = {
  id: string;
  map: string;
  date: string;
  me: RpPlayerMatch | null;
  other: RpPlayerMatch | null;
  meCombat: CompareMatchCombat | null;
  otherCombat: CompareMatchCombat | null;
};

export type CompareHitmap = {
  bones: HitBoneCounts;
  total: number;
  lastBone: string | null;
  zones: HitZonePct;
};

export type CompareSide = {
  nick: string;
  rp: number | null;
  rankLabel: string;
  rankKey: string;
  place: number | null;
  predatorPlace: number | null;
  train: PlayerTrainCombatStats | null;
  cw: PlayerKvStats | null;
  kits: KitPctRow[];
  trainHistory: TrainMatchHistoryRow[];
  cwHistory: CwMatchHistoryRow[];
  hitmap: CompareHitmap;
};

function parseRuDate(label: string): string | null {
  const m = String(label || "").trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function inRange(ymd: string | null, from: string | null, to: string | null) {
  if (!ymd) return !from && !to;
  if (from && ymd < from) return false;
  if (to && ymd > to) return false;
  return true;
}

function filterTrainHistory(
  rows: TrainMatchHistoryRow[],
  from: string | null,
  to: string | null
) {
  if (!from && !to) return rows;
  return rows.filter((r) => inRange(parseRuDate(r.dateLabel), from, to));
}

function filterCwHistory(
  rows: CwMatchHistoryRow[],
  from: string | null,
  to: string | null
) {
  if (!from && !to) return rows;
  return rows.filter((r) => inRange(parseRuDate(r.dateLabel), from, to));
}

function periodTrainFromHistory(
  nick: string,
  rows: TrainMatchHistoryRow[]
): PlayerTrainCombatStats | null {
  if (!rows.length) return null;
  let wins = 0;
  let losses = 0;
  // histories don't carry per-match combat totals here beyond win — keep overall train stats
  // but expose filtered match count + winrate from history
  for (const r of rows) {
    if (r.won === true) wins += 1;
    else if (r.won === false) losses += 1;
  }
  const matches = rows.length;
  return {
    nick,
    matches,
    wins,
    losses,
    kills: 0,
    deaths: 0,
    dmg: 0,
    res: 0,
    nok: 0,
    kd: 0,
    avgKills: 0,
    avgDmg: 0,
    winrate: matches ? Math.round((1000 * wins) / matches) / 10 : 0,
    mvpDamage: 0,
    mvpKiller: 0,
    mvpMedic: 0,
    antiDeath: 0,
  };
}

export async function buildCompareSide(
  nick: string,
  opts?: { from?: string | null; to?: string | null }
): Promise<CompareSide | null> {
  const clean = String(nick || "").trim();
  if (!clean) return null;
  const from = opts?.from || null;
  const to = opts?.to || null;

  const user = await prisma.user.findFirst({
    where: {
      profileComplete: true,
      nick: { equals: clean, mode: "insensitive" },
    },
    select: { id: true, nick: true },
  });
  const displayNick = (user?.nick || clean).trim();

  const [rp, train, cw, trainHistory, cwHistory, kits, hits] = await Promise.all([
    lookupPlayerTrainPwr(displayNick).catch(() => null),
    buildPlayerTrainCombatStats(displayNick).catch(() => null),
    buildPlayerKvStats(displayNick).catch(() => null),
    buildPlayerTrainMatchHistory(displayNick).catch(() => []),
    buildPlayerCwMatchHistory(displayNick).catch(() => []),
    user?.id
      ? kitsForUser(user.id).catch(() => ({ kits: [] as KitPctRow[] }))
      : Promise.resolve({ kits: [] as KitPctRow[] }),
    user?.id
      ? bonesForUser(user.id, {
          fromYmd: from,
          toYmd: to,
        }).catch(() => ({
          bones: {} as HitBoneCounts,
          total: 0,
          lastBone: null as string | null,
        }))
      : Promise.resolve({
          bones: {} as HitBoneCounts,
          total: 0,
          lastBone: null as string | null,
        }),
  ]);

  const trainHist = filterTrainHistory(trainHistory, from, to);
  const cwHist = filterCwHistory(cwHistory, from, to);

  return {
    nick: displayNick,
    rp: rp?.rp ?? null,
    rankLabel: rp?.rankLabel || "—",
    rankKey: rp?.rankKey || "iron",
    place: rp?.place ?? null,
    predatorPlace: rp?.predatorPlace ?? null,
    train,
    cw,
    kits: (kits.kits || []).slice(0, 6),
    trainHistory: trainHist,
    cwHistory: cwHist,
    hitmap: {
      bones: hits.bones || {},
      total: hits.total || 0,
      lastBone: hits.lastBone || null,
      zones: zonePctFromBones(hits.bones || {}),
    },
  };
}

export async function listComparableNicks(): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { profileComplete: true, nick: { not: null } },
    select: { nick: true },
    orderBy: { nick: "asc" },
    take: 800,
  });
  return users
    .map((u) => String(u.nick || "").trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "ru"));
}

export async function listCompareTrainingMatches(): Promise<RpMatchListItem[]> {
  return listRpTrainingMatches();
}

function nickKey(n: string) {
  return String(n || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

async function loadMatchCombat(
  matchId: string,
  nick: string
): Promise<CompareMatchCombat | null> {
  const bases = [
    process.env.KV_DATA_BASE,
    "https://keechbb.github.io/blackberry-kv",
    "https://kv.bb-squad.ru",
  ].filter(Boolean) as string[];

  async function fetchJson(url: string) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  let playersUrl: string | null = null;
  for (const base of bases) {
    try {
      const root = base.replace(/\/$/, "");
      const index = await fetchJson(`${root}/data/training-index.json`);
      for (const m of index.months || []) {
        const monthUrl = String(m.url || "").startsWith("http")
          ? m.url
          : `${root}/${String(m.url || "").replace(/^\//, "")}`;
        const monthData = await fetchJson(monthUrl);
        for (const match of monthData.matches || []) {
          if (String(match.id) === matchId && match.playersUrl) {
            playersUrl = String(match.playersUrl).startsWith("http")
              ? match.playersUrl
              : `${root}/${String(match.playersUrl).replace(/^\//, "")}`;
            break;
          }
        }
        if (playersUrl) break;
      }
      if (playersUrl) break;
    } catch {
      /* next base */
    }
  }
  if (!playersUrl) return null;

  try {
    const data = await fetchJson(playersUrl);
    const want = nickKey(nick);
    const list = Array.isArray(data.players) ? data.players : [];
    const mine = list.filter(
      (p: { nick?: string }) => nickKey(String(p.nick || "")) === want
    );
    if (!mine.length) return null;
    let kills = 0;
    let deaths = 0;
    let res = 0;
    let nok = 0;
    let dmg = 0;
    for (const p of mine) {
      kills += Number(p.kills) || 0;
      deaths += Number(p.deaths) || 0;
      res += Number(p.res) || 0;
      nok += Number(p.nok) || 0;
      dmg += Number(p.dmg) || 0;
    }
    return {
      kills,
      deaths,
      res,
      nok,
      dmg,
      kd: deaths > 0 ? Math.round((100 * kills) / deaths) / 100 : kills,
    };
  } catch {
    return null;
  }
}

export async function buildCompareMatch(
  meNick: string,
  otherNick: string,
  matchId: string
): Promise<CompareMatchBundle | null> {
  const id = String(matchId || "").trim();
  if (!id) return null;
  const matches = await listRpTrainingMatches();
  const meta = matches.find((m) => m.id === id);
  if (!meta) return null;

  const [me, other, meCombat, otherCombat] = await Promise.all([
    playerRpMatchBreakdown(meNick, id),
    playerRpMatchBreakdown(otherNick, id),
    loadMatchCombat(id, meNick),
    loadMatchCombat(id, otherNick),
  ]);

  return {
    id: meta.id,
    map: meta.map,
    date: meta.date,
    me,
    other,
    meCombat,
    otherCombat,
  };
}
