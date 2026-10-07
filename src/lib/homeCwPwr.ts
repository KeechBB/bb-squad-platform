import { loadTierIndex } from "@/lib/loadTierIndex";

/** Тот же композитный PWR 0–1000, что у тренировок — для клановых войн. */
export type HomeCwPwrRow = {
  nick: string;
  pwr: number;
  rankLabel: string;
  rankKey: string;
  games: number;
  place: number;
};

export type HomeCwPwrBoard = {
  top10: HomeCwPwrRow[];
  players: number;
  matches: number;
  updatedAt: string;
};

export type CwPwrLeaderboard = {
  rows: HomeCwPwrRow[];
  players: number;
  matches: number;
  updatedAt: string;
};

export type CwMatchHistoryRow = {
  matchId: string;
  dateLabel: string;
  opp: string;
  map: string;
  meeting: string;
  stack: string;
  size?: string;
  status?: string;
  r1?: string;
  r2?: string;
  playersUrl: string;
  won: boolean | null;
  pwrAfter: number;
  pwrDelta: number;
  rankLabel: string;
  rankKey: string;
};


const RATING_EXCLUDE = new Set(["shrein"]);

const CW_PWR = {
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
    [600, "Legend", "legend"],
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

type PlayerLine = {
  nick?: string;
  res?: number;
  nok?: number;
  kills?: number;
  deaths?: number;
  dmg?: number;
};

function nickKey(nick: string) {
  return nick.trim().toLowerCase().replace(/\s+/g, "");
}

function softSat(x: number, mid: number) {
  const v = Math.max(0, x);
  const m = mid || 1;
  return v / (v + m);
}

function calcCwPwr(row: Agg & { tier: number; winPct: number | null; kd: number }) {
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

  const R = softSat(r, CW_PWR.mRes);
  const N = softSat(n, CW_PWR.mNok);
  const K = softSat(k, CW_PWR.mKill);
  const C = softSat(c, CW_PWR.mDmg);
  const Surv = 1 - softSat(d, CW_PWR.mDeath);

  const s = CW_PWR.support;
  const f = CW_PWR.fight;
  const Support = s.res * R + s.nok * N + s.dmg * C;
  const Fight = f.kill * K + f.nok * N + f.dmg * C + f.res * R;
  const Role =
    CW_PWR.roleMax * Math.max(Support, Fight) +
    CW_PWR.roleAvg * ((Support + Fight) / 2);

  const imp = CW_PWR.impact;
  const Impact = imp.role * Role + imp.surv * Surv + imp.win * w;
  const Conf = g / (g + CW_PWR.confGames);
  const tierMult = CW_PWR.tierMult[row.tier] || CW_PWR.tierMult[4];
  const kdMult = row.kd < 1 ? CW_PWR.kdLowMult : 1;

  let pwr = Math.round(Impact * Conf * 1000 * tierMult * kdMult);
  if (pwr < 0) pwr = 0;
  if (pwr > 1000) pwr = 1000;

  let label = CW_PWR.bands[0][1];
  let rankKey = CW_PWR.bands[0][2];
  for (let i = CW_PWR.bands.length - 1; i >= 0; i--) {
    if (pwr >= CW_PWR.bands[i][0]) {
      label = CW_PWR.bands[i][1];
      rankKey = CW_PWR.bands[i][2];
      break;
    }
  }
  return { pwr, label, rankKey };
}

async function loadFromKv<T>(path: string): Promise<T | null> {
  const { loadKvJsonCached } = await import("@/lib/kvLocal");
  return loadKvJsonCached<T>(path.replace(/^\//, ""));
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/** Агрегат ника за встречу. */
type MeetingPlayerAgg = {
  nick: string;
  res: number;
  nok: number;
  kills: number;
  deaths: number;
  dmg: number;
  asOpp: boolean;
};

function addLinesToMeetingMap(
  out: Map<string, MeetingPlayerAgg>,
  lines: PlayerLine[] | undefined,
  asOpp: boolean
) {
  for (const p of lines || []) {
    const raw = String(p?.nick || "").trim();
    if (!raw) continue;
    const key = nickKey(raw);
    if (!out.has(key)) {
      out.set(key, {
        nick: raw,
        res: 0,
        nok: 0,
        kills: 0,
        deaths: 0,
        dmg: 0,
        asOpp,
      });
    }
    const row = out.get(key)!;
    if (!asOpp) row.asOpp = false;
    row.res += Number(p.res) || 0;
    row.nok += Number(p.nok) || 0;
    row.kills += Number(p.kills) || 0;
    row.deaths += Number(p.deaths) || 0;
    row.dmg += Number(p.dmg) || 0;
  }
}

/** Сумма r1+r2 по нику за одну встречу (только наша сторона). */
function sumMeetingPlayers(players: {
  r1?: PlayerLine[];
  r2?: PlayerLine[];
  total?: PlayerLine[];
  players?: PlayerLine[];
}): Map<string, MeetingPlayerAgg> {
  const out = new Map<string, MeetingPlayerAgg>();
  const lines =
    players.total?.length || players.players?.length
      ? ([...(players.total || []), ...(players.players || [])] as PlayerLine[])
      : ([...(players.r1 || []), ...(players.r2 || [])] as PlayerLine[]);
  addLinesToMeetingMap(out, lines, false);
  return out;
}

/** BB + соперник (oppR1/oppR2) — для истории профиля чужого ника. */
function sumMeetingPlayersBothSides(players: {
  r1?: PlayerLine[];
  r2?: PlayerLine[];
  total?: PlayerLine[];
  players?: PlayerLine[];
  oppR1?: PlayerLine[];
  oppR2?: PlayerLine[];
}): Map<string, MeetingPlayerAgg> {
  const out = sumMeetingPlayers(players);
  addLinesToMeetingMap(out, players.oppR1, true);
  addLinesToMeetingMap(out, players.oppR2, true);
  return out;
}

export function emptyHomeCwPwrBoard(): HomeCwPwrBoard {
  return {
    top10: [],
    players: 0,
    matches: 0,
    updatedAt: new Date().toISOString(),
  };
}

export function emptyCwPwrLeaderboard(): CwPwrLeaderboard {
  return {
    rows: [],
    players: 0,
    matches: 0,
    updatedAt: new Date().toISOString(),
  };
}

export async function buildCwPwrLeaderboard(): Promise<CwPwrLeaderboard> {
  const index = await loadFromKv<{
    months?: { url?: string }[];
  }>("data/index.json");
  if (!index?.months?.length) return emptyCwPwrLeaderboard();

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
        matches?: {
          playersUrl?: string;
          status?: string;
        }[];
      }>(m.url);
    })
  );

  const matchList: { playersUrl: string; status?: string }[] = [];
  for (const month of months) {
    if (!month?.matches) continue;
    for (const match of month.matches) {
      if (match.playersUrl)
        matchList.push({ playersUrl: match.playersUrl, status: match.status });
    }
  }

  const bundles = await Promise.all(
    matchList.map(async (m) => {
      const players = await loadFromKv<{
        r1?: PlayerLine[];
        r2?: PlayerLine[];
        total?: PlayerLine[];
        players?: PlayerLine[];
      }>(m.playersUrl);
      return { match: m, players };
    })
  );

  const map = new Map<string, Agg>();
  let matchesWithStats = 0;

  for (const { match, players } of bundles) {
    if (!players) continue;
    const byNick = sumMeetingPlayers(players);
    if (!byNick.size) continue;
    matchesWithStats += 1;
    const status = String(match.status || "").toLowerCase();
    const meetingWon = status === "win" ? true : status === "lose" ? false : null;

    for (const [rawKey, p] of byNick) {
      if (RATING_EXCLUDE.has(rawKey)) continue;
      const key = resolveKey(p.nick);
      if (!map.has(key)) {
        map.set(key, {
          nick: displayNick(p.nick),
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
      row.games += 1;
      if (meetingWon === true) row.wins += 1;
      row.res += p.res;
      row.nok += p.nok;
      row.kills += p.kills;
      row.deaths += p.deaths;
      row.dmg += p.dmg;
    }
  }

  const ranked: HomeCwPwrRow[] = [];
  for (const row of map.values()) {
    if (row.games <= 0) continue;
    const winPct = Math.round((1000 * row.wins) / row.games) / 10;
    const kd = row.deaths === 0 ? row.kills : row.kills / row.deaths;
    const { pwr, label, rankKey } = calcCwPwr({
      ...row,
      tier: tierOf(row.nick),
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

export async function buildHomeCwPwrBoard(): Promise<HomeCwPwrBoard> {
  const board = await buildCwPwrLeaderboard();
  return {
    top10: board.rows.slice(0, 10),
    players: board.players,
    matches: board.matches,
    updatedAt: board.updatedAt,
  };
}

export async function lookupPlayerCwPwr(
  nick: string
): Promise<HomeCwPwrRow | null> {
  const clean = String(nick || "").trim();
  if (!clean) return null;
  const board = await buildCwPwrLeaderboard();
  const tiersRaw = await loadFromKv<{ aliases?: Record<string, string> }>(
    "data/tiers.json"
  );
  const aliases = tiersRaw?.aliases || {};
  const want = nickKey(aliases[nickKey(clean)] || clean);
  return board.rows.find((r) => nickKey(r.nick) === want) || null;
}

export async function buildPlayerCwMatchHistory(
  nick: string
): Promise<CwMatchHistoryRow[]> {
  const clean = String(nick || "").trim();
  if (!clean) return [];

  const index = await loadFromKv<{
    months?: { year?: number; month?: number; url?: string }[];
  }>("data/index.json");
  if (!index?.months?.length) return [];

  const tiersRaw = await loadFromKv<{ aliases?: Record<string, string> }>(
    "data/tiers.json"
  );
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
    tierIndex.get(want) || tierIndex.get(nickKey(clean)) || 4;

  type Meta = {
    id: string;
    day: number;
    year: number;
    month: number;
    opp: string;
    map: string;
    meeting: string;
    stack: string;
    size: string;
    status: string;
    r1: string;
    r2: string;
    playersUrl: string;
    sortKey: string;
  };

  const matchMetas: Meta[] = [];
  for (const m of index.months) {
    if (!m.url || !m.year || !m.month) continue;
    const monthData = await loadFromKv<{
      matches?: {
        id?: string;
        day?: number;
        opp?: string;
        map?: string;
        meeting?: string;
        stack?: string;
        size?: string;
        status?: string;
        r1?: string;
        r2?: string;
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
        opp: match.opp || "—",
        map: match.map || "—",
        meeting: match.meeting || "—",
        stack: match.stack || "—",
        size: match.size || "—",
        status: String(match.status || ""),
        r1: match.r1 || "—",
        r2: match.r2 || "—",
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
  const history: CwMatchHistoryRow[] = [];

  const CONCURRENCY = 12;
  type PlayersDoc = {
    r1?: PlayerLine[];
    r2?: PlayerLine[];
    total?: PlayerLine[];
    players?: PlayerLine[];
    oppR1?: PlayerLine[];
    oppR2?: PlayerLine[];
  };
  const playerDocs: (PlayersDoc | null)[] = new Array(matchMetas.length).fill(
    null
  );
  for (let i = 0; i < matchMetas.length; i += CONCURRENCY) {
    const slice = matchMetas.slice(i, i + CONCURRENCY);
    const loaded = await Promise.all(
      slice.map((match) =>
        loadFromKv<PlayersDoc>(match.playersUrl).catch(() => null)
      )
    );
    for (let j = 0; j < loaded.length; j++) {
      playerDocs[i + j] = loaded[j];
    }
  }

  for (let mi = 0; mi < matchMetas.length; mi++) {
    const match = matchMetas[mi];
    const players = playerDocs[mi];
    if (!players) continue;
    const byNick = sumMeetingPlayersBothSides(players);
    let mine = byNick.get(want);
    if (!mine) {
      for (const [k, v] of byNick) {
        if (resolveKey(v.nick) === want) {
          mine = v;
          break;
        }
      }
    }
    if (!mine) continue;

    const status = match.status.toLowerCase();
    let won =
      status === "win" ? true : status === "lose" ? false : null;
    // для игрока соперника инвертируем результат встречи
    if (mine.asOpp && won != null) won = !won;

    agg.games += 1;
    if (won === true) agg.wins += 1;
    agg.res += mine.res;
    agg.nok += mine.nok;
    agg.kills += mine.kills;
    agg.deaths += mine.deaths;
    agg.dmg += mine.dmg;

    const winPct = Math.round((1000 * agg.wins) / agg.games) / 10;
    const kd = agg.deaths === 0 ? agg.kills : agg.kills / agg.deaths;
    const { pwr, label, rankKey } = calcCwPwr({
      ...agg,
      tier,
      winPct,
      kd,
    });
    const pwrDelta = pwr - prevPwr;
    prevPwr = pwr;

    history.push({
      matchId: match.id,
      dateLabel: `${pad2(match.day)}.${pad2(match.month)}.${match.year}`,
      opp: mine.asOpp ? "BB" : match.opp,
      map: match.map,
      meeting: match.meeting,
      stack: match.stack,
      size: match.size,
      status: match.status,
      r1: match.r1,
      r2: match.r2,
      playersUrl: match.playersUrl,
      won,
      pwrAfter: pwr,
      pwrDelta,
      rankLabel: label,
      rankKey,
    });
  }

  return history.reverse();
}
