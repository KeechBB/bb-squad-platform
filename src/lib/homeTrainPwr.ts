import { loadTierIndex } from "@/lib/tiers";

export type HomeTrainPwrRow = {
  nick: string;
  pwr: number;
  rankLabel: string;
  rankKey: string;
  games: number;
  place: number;
};

export type HomeTrainPwrBoard = {
  top10: HomeTrainPwrRow[];
  players: number;
  matches: number;
  updatedAt: string;
};

export type TrainPwrLeaderboard = {
  rows: HomeTrainPwrRow[];
  players: number;
  matches: number;
  updatedAt: string;
};

const KV_BASES = [
  process.env.KV_DATA_BASE,
  "https://keechbb.github.io/blackberry-kv",
  "https://kv.bb-squad.ru",
].filter(Boolean) as string[];

const RATING_EXCLUDE = new Set(["shrein"]);

const TRAIN_PWR = {
  mRes: 4,
  mNok: 3,
  mKill: 2.5,
  mDmg: 150,
  mDeath: 6,
  confGames: 5,
  support: { res: 0.7, nok: 0.15, dmg: 0.15 },
  fight: { kill: 0.35, nok: 0.25, dmg: 0.3, res: 0.1 },
  roleMax: 0.65,
  roleAvg: 0.35,
  impact: { role: 0.55, surv: 0.2, win: 0.25 },
  tierMult: { 1: 1.4, 2: 1.3, 3: 1.2, 4: 1.1 } as Record<number, number>,
  kdLowMult: 0.9,
  bands: [
    [0, "Iron", "iron"],
    [100, "Bronze", "bronze"],
    [200, "Silver", "silver"],
    [300, "Gold", "gold"],
    [400, "Platinum", "platinum"],
    [500, "Diamond", "diamond"],
    [600, "Ascendant", "ascendant"],
    [700, "Immortal", "immortal"],
    [800, "Master", "master"],
    [900, "Radiant", "radiant"],
  ] as [number, string, string][],
};

type Agg = {
  nick: string;
  games: number;
  wins: number;
  res: number;
  nok: number;
  kills: number;
  deaths: number;
  dmg: number;
};

function nickKey(nick: string) {
  return nick.trim().toLowerCase().replace(/\s+/g, " ");
}

function softSat(x: number, mid: number) {
  const v = Math.max(0, x);
  const m = mid || 1;
  return v / (v + m);
}

function calcTrainPwr(row: Agg & { tier: number; winPct: number | null; kd: number }) {
  const g = Math.max(1, row.games);
  const r = row.res / g;
  const n = row.nok / g;
  const k = row.kills / g;
  const d = row.deaths / g;
  const c = row.dmg / g;
  const w =
    row.winPct == null || row.games <= 0
      ? 0
      : Math.min(1, Math.max(0, row.winPct / 100));

  const R = softSat(r, TRAIN_PWR.mRes);
  const N = softSat(n, TRAIN_PWR.mNok);
  const K = softSat(k, TRAIN_PWR.mKill);
  const C = softSat(c, TRAIN_PWR.mDmg);
  const Surv = 1 - softSat(d, TRAIN_PWR.mDeath);

  const s = TRAIN_PWR.support;
  const f = TRAIN_PWR.fight;
  const Support = s.res * R + s.nok * N + s.dmg * C;
  const Fight = f.kill * K + f.nok * N + f.dmg * C + f.res * R;
  const Role =
    TRAIN_PWR.roleMax * Math.max(Support, Fight) +
    TRAIN_PWR.roleAvg * ((Support + Fight) / 2);

  const imp = TRAIN_PWR.impact;
  const Impact = imp.role * Role + imp.surv * Surv + imp.win * w;
  const Conf = g / (g + TRAIN_PWR.confGames);
  const tierMult = TRAIN_PWR.tierMult[row.tier] || TRAIN_PWR.tierMult[4];
  const kdMult = row.kd < 1 ? TRAIN_PWR.kdLowMult : 1;

  let pwr = Math.round(Impact * Conf * 1000 * tierMult * kdMult);
  if (pwr < 0) pwr = 0;
  if (pwr > 1000) pwr = 1000;

  let label = TRAIN_PWR.bands[0][1];
  let rankKey = TRAIN_PWR.bands[0][2];
  for (let i = TRAIN_PWR.bands.length - 1; i >= 0; i--) {
    if (pwr >= TRAIN_PWR.bands[i][0]) {
      label = TRAIN_PWR.bands[i][1];
      rankKey = TRAIN_PWR.bands[i][2];
      break;
    }
  }
  return { pwr, label, rankKey };
}

async function fetchJson(url: string) {
  const res = await fetch(url, { next: { revalidate: 120 } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function loadFromKv<T>(path: string): Promise<T | null> {
  for (const base of KV_BASES) {
    try {
      return (await fetchJson(
        `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`
      )) as T;
    } catch {
      /* next */
    }
  }
  return null;
}

export function emptyHomeTrainPwrBoard(): HomeTrainPwrBoard {
  return {
    top10: [],
    players: 0,
    matches: 0,
    updatedAt: new Date().toISOString(),
  };
}

export function emptyTrainPwrLeaderboard(): TrainPwrLeaderboard {
  return {
    rows: [],
    players: 0,
    matches: 0,
    updatedAt: new Date().toISOString(),
  };
}

export async function buildTrainPwrLeaderboard(): Promise<TrainPwrLeaderboard> {
  const index = await loadFromKv<{
    months?: { url?: string }[];
    bust?: string;
  }>("data/training-index.json");
  if (!index?.months?.length) return emptyTrainPwrLeaderboard();

  const tiersRaw = await loadFromKv<{
    aliases?: Record<string, string>;
  }>("data/tiers.json");
  const aliases = tiersRaw?.aliases || {};
  const aliasCanon = new Map<string, string>();
  for (const [a, c] of Object.entries(aliases)) {
    aliasCanon.set(nickKey(a), String(c));
  }
  const resolveKey = (nick: string) => {
    const key = nickKey(nick);
    const canon = aliasCanon.get(key);
    return canon ? nickKey(canon) : key;
  };
  const displayNick = (nick: string) => {
    const key = nickKey(nick);
    const canon = aliasCanon.get(key);
    return canon || nick.trim();
  };

  const tierIndex = await loadTierIndex();
  const tierOf = (nick: string) =>
    tierIndex.get(resolveKey(nick)) || tierIndex.get(nickKey(nick)) || 4;

  const months = await Promise.all(
    index.months.map(async (m) => {
      if (!m.url) return null;
      return loadFromKv<{
        matches?: { playersUrl?: string; winner?: string }[];
      }>(m.url);
    })
  );

  const matchList: { playersUrl: string; winner?: string }[] = [];
  for (const month of months) {
    if (!month?.matches) continue;
    for (const match of month.matches) {
      if (match.playersUrl)
        matchList.push({ playersUrl: match.playersUrl, winner: match.winner });
    }
  }

  const bundles = await Promise.all(
    matchList.map(async (m) => {
      const players = await loadFromKv<{
        players?: Record<string, unknown>[];
        teamA?: Record<string, unknown>[];
        teamB?: Record<string, unknown>[];
        winner?: string;
      }>(m.playersUrl);
      return { match: m, players };
    })
  );

  const map = new Map<string, Agg>();
  let matchesWithStats = 0;

  for (const { match, players } of bundles) {
    if (!players) continue;
    matchesWithStats += 1;
    const list = (
      players.players?.length
        ? players.players
        : [...(players.teamA || []), ...(players.teamB || [])]
    ) as {
      nick?: string;
      res?: number;
      nok?: number;
      kills?: number;
      deaths?: number;
      dmg?: number;
      team?: string;
      won?: boolean;
    }[];

    const winner = String(match.winner || players.winner || "").toUpperCase();
    const seen = new Set<string>();

    for (const p of list) {
      const raw = String(p?.nick || "").trim();
      if (!raw || RATING_EXCLUDE.has(nickKey(raw))) continue;
      const key = resolveKey(raw);
      if (!map.has(key)) {
        map.set(key, {
          nick: displayNick(raw),
          games: 0,
          wins: 0,
          res: 0,
          nok: 0,
          kills: 0,
          deaths: 0,
          dmg: 0,
        });
      }
      const row = map.get(key)!;
      row.res += Number(p.res) || 0;
      row.nok += Number(p.nok) || 0;
      row.kills += Number(p.kills) || 0;
      row.deaths += Number(p.deaths) || 0;
      row.dmg += Number(p.dmg) || 0;
      if (seen.has(key)) continue;
      seen.add(key);
      row.games += 1;
      const team = String(p.team || "").toUpperCase();
      const won =
        p.won === true || (Boolean(winner) && Boolean(team) && team === winner);
      if (won) row.wins += 1;
    }
  }

  const ranked: HomeTrainPwrRow[] = [];
  for (const row of map.values()) {
    if (row.games <= 0) continue;
    const winPct = Math.round((1000 * row.wins) / row.games) / 10;
    const kd = row.deaths === 0 ? row.kills : row.kills / row.deaths;
    const tier = tierOf(row.nick);
    const { pwr, label, rankKey } = calcTrainPwr({
      ...row,
      tier,
      winPct,
      kd,
    });
    ranked.push({
      nick: row.nick,
      pwr,
      rankLabel: label,
      rankKey,
      games: row.games,
      place: 0,
    });
  }

  ranked.sort(
    (a, b) => b.pwr - a.pwr || b.games - a.games || a.nick.localeCompare(b.nick, "ru")
  );
  ranked.forEach((r, i) => {
    r.place = i + 1;
  });

  return {
    rows: ranked,
    players: ranked.length,
    matches: matchesWithStats,
    updatedAt: new Date().toISOString(),
  };
}

export async function buildHomeTrainPwrBoard(): Promise<HomeTrainPwrBoard> {
  const board = await buildTrainPwrLeaderboard();
  return {
    top10: board.rows.slice(0, 10),
    players: board.players,
    matches: board.matches,
    updatedAt: board.updatedAt,
  };
}

/** Профиль: PWR / Rank / место по нику (алиасы из tiers.json). */
export async function lookupPlayerTrainPwr(
  nick: string
): Promise<HomeTrainPwrRow | null> {
  const clean = String(nick || "").trim();
  if (!clean) return null;
  const board = await buildTrainPwrLeaderboard();
  if (!board.rows.length) return null;

  const tiersRaw = await loadFromKv<{
    aliases?: Record<string, string>;
  }>("data/tiers.json");
  const aliases = tiersRaw?.aliases || {};
  const aliasCanon = new Map<string, string>();
  for (const [a, c] of Object.entries(aliases)) {
    aliasCanon.set(nickKey(a), String(c));
  }
  const resolveKey = (n: string) => {
    const key = nickKey(n);
    const canon = aliasCanon.get(key);
    return canon ? nickKey(canon) : key;
  };
  const want = resolveKey(clean);
  return board.rows.find((r) => resolveKey(r.nick) === want) || null;
}

export type TrainMatchHistoryRow = {
  matchId: string;
  dateLabel: string;
  timeLabel: string;
  map: string;
  factionA: string;
  ticketsA: number | null;
  factionB: string;
  ticketsB: number | null;
  team: string;
  won: boolean | null;
  pwrAfter: number;
  pwrDelta: number;
  rankLabel: string;
  rankKey: string;
};

type MatchMeta = {
  id: string;
  day: number;
  year: number;
  month: number;
  timeMsk?: string;
  map?: string;
  factionA?: string;
  ticketsA?: number | null;
  factionB?: string;
  ticketsB?: number | null;
  winner?: string;
  playersUrl: string;
  sortKey: string;
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/** История тренировок игрока с ΔPWR после каждой катки (хронология). */
export async function buildPlayerTrainMatchHistory(
  nick: string
): Promise<TrainMatchHistoryRow[]> {
  const clean = String(nick || "").trim();
  if (!clean) return [];

  const index = await loadFromKv<{
    months?: { year?: number; month?: number; url?: string }[];
  }>("data/training-index.json");
  if (!index?.months?.length) return [];

  const tiersRaw = await loadFromKv<{
    aliases?: Record<string, string>;
  }>("data/tiers.json");
  const aliases = tiersRaw?.aliases || {};
  const aliasCanon = new Map<string, string>();
  for (const [a, c] of Object.entries(aliases)) {
    aliasCanon.set(nickKey(a), String(c));
  }
  const resolveKey = (n: string) => {
    const key = nickKey(n);
    const canon = aliasCanon.get(key);
    return canon ? nickKey(canon) : key;
  };
  const want = resolveKey(clean);

  const tierIndex = await loadTierIndex();
  const tier =
    tierIndex.get(want) ||
    tierIndex.get(nickKey(clean)) ||
    4;

  const matchMetas: MatchMeta[] = [];
  for (const m of index.months) {
    if (!m.url || !m.year || !m.month) continue;
    const monthData = await loadFromKv<{
      matches?: {
        id?: string;
        day?: number;
        timeMsk?: string;
        map?: string;
        factionA?: string;
        ticketsA?: number | null;
        factionB?: string;
        ticketsB?: number | null;
        winner?: string;
        playersUrl?: string;
      }[];
    }>(m.url);
    for (const match of monthData?.matches || []) {
      if (!match.playersUrl || !match.id || match.day == null) continue;
      matchMetas.push({
        id: match.id,
        day: match.day,
        year: m.year,
        month: m.month,
        timeMsk: match.timeMsk,
        map: match.map,
        factionA: match.factionA,
        ticketsA: match.ticketsA ?? null,
        factionB: match.factionB,
        ticketsB: match.ticketsB ?? null,
        winner: match.winner,
        playersUrl: match.playersUrl,
        sortKey: `${m.year}-${pad2(m.month)}-${pad2(match.day)}-${match.id}`,
      });
    }
  }
  matchMetas.sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  const agg: Agg = {
    nick: clean,
    games: 0,
    wins: 0,
    res: 0,
    nok: 0,
    kills: 0,
    deaths: 0,
    dmg: 0,
  };
  let prevPwr = 0;
  const history: TrainMatchHistoryRow[] = [];

  for (const match of matchMetas) {
    const players = await loadFromKv<{
      players?: Record<string, unknown>[];
      teamA?: Record<string, unknown>[];
      teamB?: Record<string, unknown>[];
      winner?: string;
    }>(match.playersUrl);
    if (!players) continue;
    const list = (
      players.players?.length
        ? players.players
        : [...(players.teamA || []), ...(players.teamB || [])]
    ) as {
      nick?: string;
      res?: number;
      nok?: number;
      kills?: number;
      deaths?: number;
      dmg?: number;
      team?: string;
      won?: boolean;
    }[];

    const mine = list.filter((p) => p?.nick && resolveKey(p.nick) === want);
    if (!mine.length) continue;

    // один ник на катку — суммируем статы если дубль OCR
    let res = 0;
    let nok = 0;
    let kills = 0;
    let deaths = 0;
    let dmg = 0;
    let team = "";
    for (const p of mine) {
      res += Number(p.res) || 0;
      nok += Number(p.nok) || 0;
      kills += Number(p.kills) || 0;
      deaths += Number(p.deaths) || 0;
      dmg += Number(p.dmg) || 0;
      if (!team && p.team) team = String(p.team);
    }

    const winner = String(match.winner || players.winner || "").toUpperCase();
    const teamU = team.toUpperCase();
    const wonExplicit = mine.some((p) => p.won === true);
    const wonFromWinner =
      Boolean(winner) && Boolean(teamU) && teamU === winner;
    const lostFromWinner =
      Boolean(winner) && Boolean(teamU) && teamU !== winner;
    const won: boolean | null = wonExplicit || wonFromWinner
      ? true
      : lostFromWinner
        ? false
        : null;

    agg.games += 1;
    if (won === true) agg.wins += 1;
    agg.res += res;
    agg.nok += nok;
    agg.kills += kills;
    agg.deaths += deaths;
    agg.dmg += dmg;

    const winPct = Math.round((1000 * agg.wins) / agg.games) / 10;
    const kd = agg.deaths === 0 ? agg.kills : agg.kills / agg.deaths;
    const { pwr, label, rankKey } = calcTrainPwr({
      ...agg,
      tier,
      winPct,
      kd,
    });
    const pwrDelta = pwr - prevPwr;
    prevPwr = pwr;

    const timeRaw = String(match.timeMsk || "").trim();
    history.push({
      matchId: match.id,
      dateLabel: `${pad2(match.day)}.${pad2(match.month)}.${match.year}`,
      timeLabel: timeRaw && timeRaw !== "—" ? timeRaw : "—",
      map: match.map || "—",
      factionA: String(match.factionA || "—").toUpperCase(),
      ticketsA: match.ticketsA ?? null,
      factionB: String(match.factionB || "—").toUpperCase(),
      ticketsB: match.ticketsB ?? null,
      team: teamU || "—",
      won: won,
      pwrAfter: pwr,
      pwrDelta,
      rankLabel: label,
      rankKey,
    });
  }

  // свежие сверху
  return history.reverse();
}
