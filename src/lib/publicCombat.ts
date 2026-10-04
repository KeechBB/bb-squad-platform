/**
 * Public (PB1) combat + MVP aggregates from digitized public matches.
 * Hot path: slim data/public/rp-ladder.json (~1MB), not full rp-ledger (~30MB).
 */
import { unstable_cache } from "next/cache";
import { pickMvps, type MvpBlock } from "@/lib/homeMvp";
import { buildPublicAttendanceLeaderboard } from "@/lib/publicAttendance";
import { buildPublicRpLeaderboard, lookupPlayerPublicRp } from "@/lib/publicRp";
import { rpRankFromScore } from "@/lib/trainRp";
import { prisma } from "@/lib/prisma";

const KV_BASES = [
  process.env.KV_DATA_BASE,
  "https://keechbb.github.io/blackberry-kv",
].filter(Boolean) as string[];

function nickKey(n: string) {
  return String(n || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

async function fetchJson(url: string) {
  const res = await fetch(url, { next: { revalidate: 90 } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function loadFromKv<T>(rel: string): Promise<T | null> {
  for (const base of KV_BASES) {
    try {
      return (await fetchJson(`${base.replace(/\/$/, "")}/${rel}`)) as T;
    } catch {
      /* next */
    }
  }
  try {
    const { readFile } = await import("fs/promises");
    const { join } = await import("path");
    const p = join(process.cwd(), "..", "KV", "public", rel);
    const raw = await readFile(p, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

type StatRow = {
  nick: string;
  res?: number;
  nok?: number;
  kills?: number;
  deaths?: number;
  dmg?: number;
  won?: boolean;
};

export type PublicCombatRow = {
  place: number;
  nick: string;
  steamId: string | null;
  clan: string;
  rp: number | null;
  rankLabel: string;
  rankKey: string;
  games: number;
  wins: number;
  winPct: number | null;
  res: number;
  nok: number;
  kills: number;
  deaths: number;
  kd: number;
  dmg: number;
  mvpMedic: number;
  mvpKiller: number;
  mvpDamage: number;
  antiDeath: number;
  /** days on PB1 (attendance) */
  days: number;
  /** registered on site — nick is linkable */
  hasProfile: boolean;
};

export type PlayerPublicCombatStats = {
  nick: string;
  matches: number;
  wins: number;
  losses: number;
  kills: number;
  deaths: number;
  dmg: number;
  res: number;
  nok: number;
  kd: number;
  avgKills: number;
  avgDmg: number;
  winrate: number;
  mvpDamage: number;
  mvpKiller: number;
  mvpMedic: number;
  antiDeath: number;
  days: number;
};

type Acc = {
  nick: string;
  games: number;
  wins: number;
  res: number;
  nok: number;
  kills: number;
  deaths: number;
  dmg: number;
  mvpMedic: number;
  mvpKiller: number;
  mvpDamage: number;
  antiDeath: number;
};

function emptyAcc(nick: string): Acc {
  return {
    nick,
    games: 0,
    wins: 0,
    res: 0,
    nok: 0,
    kills: 0,
    deaths: 0,
    dmg: 0,
    mvpMedic: 0,
    mvpKiller: 0,
    mvpDamage: 0,
    antiDeath: 0,
  };
}

function n(v: unknown) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function mvpFromPlayers(players: {
  mvp?: { public?: MvpBlock; train?: MvpBlock };
  total?: StatRow[];
  teamA?: StatRow[];
  teamB?: StatRow[];
  players?: StatRow[];
}): MvpBlock {
  const block = players.mvp?.public || players.mvp?.train;
  if (block) return block;
  const rows =
    players.total ||
    players.players ||
    [...(players.teamA || []), ...(players.teamB || [])];
  return pickMvps(rows || []);
}

type PublicBundle = {
  players: {
    mvp?: { public?: MvpBlock; train?: MvpBlock };
    total?: StatRow[];
    teamA?: StatRow[];
    teamB?: StatRow[];
    players?: StatRow[];
  } | null;
};

async function loadPublicMatchBundlesFromKv(): Promise<PublicBundle[]> {
  const index = await loadFromKv<{
    months?: { url?: string }[];
  }>("data/public/index.json");
  if (!index?.months?.length) return [];

  const matchUrls: string[] = [];
  for (const m of index.months) {
    if (!m.url) continue;
    const month = await loadFromKv<{
      matches?: { playersUrl?: string }[];
    }>(m.url);
    for (const row of month?.matches || []) {
      if (row.playersUrl) matchUrls.push(row.playersUrl);
    }
  }

  return Promise.all(
    matchUrls.map(async (url) => {
      const players = await loadFromKv<{
        mvp?: { public?: MvpBlock; train?: MvpBlock };
        total?: StatRow[];
        teamA?: StatRow[];
        teamB?: StatRow[];
        players?: StatRow[];
      }>(url);
      return { players };
    })
  );
}

function countStat(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, v);
  if (Array.isArray(v)) return v.length;
  return 0;
}

/** Combat rows from slim public ladder (or full ledger fallback). */
async function loadPublicMatchBundlesFromLedger(): Promise<PublicBundle[]> {
  const { loadPublicRpLadder, loadPublicRpLedger } = await import("@/lib/publicRp");
  const ledger =
    (await loadPublicRpLadder()) || (await loadPublicRpLedger());
  if (!ledger?.players || !ledger.matches?.length) return [];

  type Pm = {
    id: string;
    kills?: unknown;
    deaths?: unknown;
    revives?: unknown;
    noks?: unknown;
    dmg?: number;
    won?: boolean | null;
  };

  // matchId → nick → stats
  const byMatch = new Map<string, Map<string, StatRow & { won?: boolean }>>();
  for (const p of Object.values(ledger.players)) {
    const nick = String(p.nick || "").trim();
    if (!nick) continue;
    for (const m of (p.matches || []) as Pm[]) {
      if (!m?.id) continue;
      if (!byMatch.has(m.id)) byMatch.set(m.id, new Map());
      const row = byMatch.get(m.id)!;
      const prev = row.get(nickKey(nick)) || {
        nick,
        kills: 0,
        deaths: 0,
        res: 0,
        nok: 0,
        dmg: 0,
      };
      prev.kills = (prev.kills || 0) + countStat(m.kills);
      prev.deaths = (prev.deaths || 0) + countStat(m.deaths);
      prev.res = (prev.res || 0) + countStat(m.revives);
      prev.nok = (prev.nok || 0) + countStat(m.noks);
      prev.dmg = Math.round((prev.dmg || 0) + (Number(m.dmg) || 0));
      if (m.won === true) prev.won = true;
      if (m.won === false && prev.won !== true) prev.won = false;
      row.set(nickKey(nick), prev);
    }
  }

  const bundles: PublicBundle[] = [];
  for (const m of ledger.matches) {
    const rows = byMatch.get(m.id);
    if (!rows?.size) continue;
    const total = [...rows.values()];
    bundles.push({
      players: {
        total,
        mvp: { public: pickMvps(total) },
      },
    });
  }
  return bundles;
}

async function loadPublicMatchBundles(): Promise<PublicBundle[]> {
  // Combat/RP always from PB1 log ledger (history-linked). Manual KV digitization is legacy.
  const fromLedger = await loadPublicMatchBundlesFromLedger();
  if (fromLedger.length) return fromLedger;
  return loadPublicMatchBundlesFromKv();
}

function aggregateCombat(
  bundles: Awaited<ReturnType<typeof loadPublicMatchBundles>>
) {
  const map = new Map<string, Acc>();
  const touch = (nick: string) => {
    const k = nickKey(nick);
    if (!k) return null;
    if (!map.has(k)) map.set(k, emptyAcc(nick.trim()));
    return map.get(k)!;
  };

  for (const { players } of bundles) {
    if (!players) continue;
    const rows =
      players.total ||
      players.players ||
      [...(players.teamA || []), ...(players.teamB || [])];
    const seen = new Set<string>();
    for (const p of rows || []) {
      if (!p?.nick) continue;
      const row = touch(p.nick);
      if (!row) continue;
      const k = nickKey(p.nick);
      if (!seen.has(k)) {
        seen.add(k);
        row.games += 1;
        if (p.won === true) row.wins += 1;
      }
      row.res += n(p.res);
      row.nok += n(p.nok);
      row.kills += n(p.kills);
      row.deaths += n(p.deaths);
      row.dmg += n(p.dmg);
      if (p.nick.trim() && !row.nick) row.nick = p.nick.trim();
    }
    const mvp = mvpFromPlayers(players);
    const bump = (list: string[] | undefined, field: keyof Acc) => {
      for (const nick of list || []) {
        const row = touch(nick);
        if (!row) continue;
        (row[field] as number) += 1;
      }
    };
    bump(mvp.medic, "mvpMedic");
    bump(mvp.killer, "mvpKiller");
    bump(mvp.damage, "mvpDamage");
    bump(mvp.antiDeath, "antiDeath");
  }
  return map;
}

async function buildPublicRatingTableUncached(limit = 500): Promise<{
  rows: PublicCombatRow[];
  matches: number;
  updatedAt: string;
}> {
  const [bundles, att, rpBoard, users] = await Promise.all([
    loadPublicMatchBundles(),
    buildPublicAttendanceLeaderboard(2000),
    buildPublicRpLeaderboard(),
    prisma.user.findMany({
      where: { profileComplete: true, nick: { not: null } },
      select: {
        nick: true,
        steamId: true,
        clanMemberships: {
          take: 1,
          include: { clan: { select: { tag: true } } },
        },
      },
    }),
  ]);

  const combat = aggregateCombat(bundles);
  const clanByNick = new Map<string, string>();
  const steamByNick = new Map<string, string>();
  for (const u of users) {
    if (!u.nick) continue;
    const k = nickKey(u.nick);
    const tag = u.clanMemberships[0]?.clan?.tag;
    if (tag) clanByNick.set(k, tag);
    if (u.steamId) steamByNick.set(k, u.steamId);
  }

  const attByNick = new Map(att.map((a) => [nickKey(a.nick), a]));
  const attBySteam = new Map(att.map((a) => [a.steamId, a]));
  const rpByNick = new Map(rpBoard.rows.map((r) => [nickKey(r.nick), r]));

  type Merge = {
    nick: string;
    steamId: string | null;
    hasProfile: boolean;
    days: number;
    combatKey: string | null;
    rpKey: string | null;
  };
  const merged = new Map<string, Merge>();

  const put = (key: string, patch: Partial<Merge> & { nick: string }) => {
    const cur = merged.get(key) || {
      nick: patch.nick,
      steamId: null,
      hasProfile: false,
      days: 0,
      combatKey: null,
      rpKey: null,
    };
    merged.set(key, {
      nick: patch.nick || cur.nick,
      steamId: patch.steamId ?? cur.steamId,
      hasProfile: Boolean(patch.hasProfile || cur.hasProfile),
      days: Math.max(cur.days, patch.days || 0),
      combatKey: patch.combatKey ?? cur.combatKey,
      rpKey: patch.rpKey ?? cur.rpKey,
    });
  };

  // Rating universe = players with combat/RP from history-linked ledger.
  // Attendance only enriches days/steam for those players (no empty filler rows).
  for (const [ck, c] of combat) {
    const steam = steamByNick.get(ck);
    const attHit = steam
      ? attBySteam.get(steam)
      : attByNick.get(ck);
    const key = attHit?.steamId || steam || `nick:${ck}`;
    put(key, {
      nick: attHit?.nick || c.nick,
      steamId: attHit?.steamId || steam || null,
      hasProfile: attHit?.hasProfile || Boolean(steam),
      days: attHit?.days || 0,
      combatKey: ck,
    });
  }

  for (const [rk, r] of rpByNick) {
    const steam = steamByNick.get(rk);
    const attHit = steam
      ? attBySteam.get(steam)
      : attByNick.get(rk);
    const key = attHit?.steamId || steam || `nick:${rk}`;
    put(key, {
      nick: attHit?.nick || r.nick,
      steamId: attHit?.steamId || steam || null,
      hasProfile: attHit?.hasProfile || Boolean(steam),
      days: attHit?.days || 0,
      rpKey: rk,
    });
  }

  const rows: PublicCombatRow[] = [];
  for (const m of merged.values()) {
    const c = m.combatKey ? combat.get(m.combatKey) : undefined;
    const rp = m.rpKey
      ? rpByNick.get(m.rpKey)
      : rpByNick.get(nickKey(m.nick));
    const games = c?.games || 0;
    const wins = c?.wins || 0;
    const kills = c?.kills || 0;
    const deaths = c?.deaths || 0;
    const rpVal = rp?.rp ?? null;
    const rank =
      rp != null
        ? { label: rp.rankLabel, key: rp.rankKey }
        : rpVal != null
          ? (() => {
              const r = rpRankFromScore(rpVal);
              return { label: r.label, key: r.rankKey };
            })()
          : { label: "—", key: "iron" };
    rows.push({
      place: 0,
      nick: m.nick,
      steamId: m.steamId,
      clan: clanByNick.get(nickKey(m.nick)) || "—",
      rp: rpVal,
      rankLabel: rank.label,
      rankKey: rank.key,
      games,
      wins,
      winPct: games > 0 ? Math.round((1000 * wins) / games) / 10 : null,
      res: c?.res || 0,
      nok: c?.nok || 0,
      kills,
      deaths,
      kd: deaths > 0 ? Math.round((kills / deaths) * 100) / 100 : kills,
      dmg: Math.round(c?.dmg || 0),
      mvpMedic: c?.mvpMedic || 0,
      mvpKiller: c?.mvpKiller || 0,
      mvpDamage: c?.mvpDamage || 0,
      antiDeath: c?.antiDeath || 0,
      days: m.days,
      hasProfile: m.hasProfile,
    });
  }

  rows.sort((a, b) => {
    const ar = a.rp == null ? -1e9 : a.rp;
    const br = b.rp == null ? -1e9 : b.rp;
    if (ar !== br) return br - ar;
    if (
      b.mvpMedic + b.mvpKiller + b.mvpDamage !==
      a.mvpMedic + a.mvpKiller + a.mvpDamage
    ) {
      return (
        b.mvpMedic +
        b.mvpKiller +
        b.mvpDamage -
        (a.mvpMedic + a.mvpKiller + a.mvpDamage)
      );
    }
    if (b.days !== a.days) return b.days - a.days;
    return a.nick.localeCompare(b.nick, "ru");
  });

  rows.forEach((r, i) => {
    r.place = i + 1;
  });

  return {
    rows: rows.slice(0, limit),
    matches: bundles.filter((b) => b.players).length,
    updatedAt: new Date().toISOString(),
  };
}

/** Cached hot path — avoid re-parsing public ladder on every /public hit. */
export async function buildPublicRatingTable(limit = 500): Promise<{
  rows: PublicCombatRow[];
  matches: number;
  updatedAt: string;
}> {
  const cached = unstable_cache(
    () => buildPublicRatingTableUncached(limit),
    ["public-rating-table-v2-slim", String(limit)],
    { revalidate: 120 }
  );
  return cached();
}

export async function buildPlayerPublicCombatStats(
  nick: string
): Promise<PlayerPublicCombatStats | null> {
  const clean = String(nick || "").trim();
  if (!clean) return null;
  const want = nickKey(clean);
  const [table, att] = await Promise.all([
    buildPublicRatingTable(500),
    buildPublicAttendanceLeaderboard(500),
  ]);
  const row = table.rows.find((r) => nickKey(r.nick) === want);
  const days = att.find((a) => nickKey(a.nick) === want)?.days || 0;
  if (!row) {
    return {
      nick: clean,
      matches: 0,
      wins: 0,
      losses: 0,
      kills: 0,
      deaths: 0,
      dmg: 0,
      res: 0,
      nok: 0,
      kd: 0,
      avgKills: 0,
      avgDmg: 0,
      winrate: 0,
      mvpDamage: 0,
      mvpKiller: 0,
      mvpMedic: 0,
      antiDeath: 0,
      days,
    };
  }
  const losses = Math.max(0, row.games - row.wins);
  return {
    nick: row.nick,
    matches: row.games,
    wins: row.wins,
    losses,
    kills: row.kills,
    deaths: row.deaths,
    dmg: Math.round(row.dmg),
    res: row.res,
    nok: row.nok,
    kd: row.kd,
    avgKills: row.games ? Math.round((row.kills / row.games) * 10) / 10 : 0,
    avgDmg: row.games ? Math.round(row.dmg / row.games) : 0,
    winrate: row.winPct ?? 0,
    mvpDamage: row.mvpDamage,
    mvpKiller: row.mvpKiller,
    mvpMedic: row.mvpMedic,
    antiDeath: row.antiDeath,
    days: row.days || days,
  };
}

export async function lookupPublicProfileSummary(nick: string) {
  const [combat, rp] = await Promise.all([
    buildPlayerPublicCombatStats(nick),
    lookupPlayerPublicRp(nick),
  ]);
  return { combat, rp };
}
