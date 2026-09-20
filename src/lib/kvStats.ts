export type KvMatch = {
  id?: string;
  day?: number;
  year?: number;
  month?: number;
  opp?: string;
  map?: string;
  stack?: string;
  status?: string;
  meeting?: string;
  size?: string;
  playersUrl?: string;
};

export type PlayerKvRound = {
  matchId: string;
  day: number;
  opp: string;
  map: string;
  stack: string;
  status: string;
  meeting: string;
  round: "r1" | "r2";
  kills: number;
  deaths: number;
  dmg: number;
  res: number;
  nok: number;
};

/** Агрегат по всей встрече (r1+r2) */
export type PlayerKvMatch = {
  matchId: string;
  day: number;
  opp: string;
  map: string;
  stack: string;
  status: string;
  meeting: string;
  roundsPlayed: number;
  kills: number;
  deaths: number;
  dmg: number;
  res: number;
  nok: number;
};

export type PlayerKvAward = {
  matchId: string;
  day: number;
  dateLabel: string;
  opp: string;
  round: string;
  type: string;
  label: string;
};

export type PlayerKvStats = {
  nick: string;
  rounds: number;
  matches: number;
  kills: number;
  deaths: number;
  dmg: number;
  res: number;
  nok: number;
  kd: number;
  avgKills: number;
  avgDmg: number;
  wins: number;
  draws: number;
  losses: number;
  winrate: number;
  awards: PlayerKvAward[];
  mvpDamage: number;
  mvpKiller: number;
  mvpMedic: number;
  antiDeath: number;
  byStack: { name: string; rounds: number; kills: number; deaths: number; dmg: number }[];
  recent: PlayerKvRound[];
  recentMatches: PlayerKvMatch[];
  source: string;
};

export type ClanStats = {
  total: number;
  played: number;
  upcoming: number;
  wins: number;
  draws: number;
  losses: number;
  winrate: number;
  byStack: { name: string; played: number; wins: number; draws: number; losses: number; winrate: number }[];
  maps: { map: string; full: string; games: number; wins: number; losses: number; draws: number }[];
  recent: { day: number; opp: string; map: string; stack: string; status: string; meeting: string }[];
  source: string;
};

const KV_BASES = [
  process.env.KV_DATA_BASE,
  "https://kv.bb-squad.ru",
  "https://keechbb.github.io/blackberry-kv",
].filter(Boolean) as string[];

function shortMap(map: string): string {
  let s = map.trim();
  s = s.replace(/^(SEC|BALT|OOTB)\s+/i, "");
  s = s.replace(/^\d+\s+/, "");
  s = s.replace(/\s+(AAS|PAAS|RAAS|TC|Invasion|Seed).*$/i, "");
  s = s.replace(/\s+v\d+$/i, "");
  return s.trim() || map;
}

async function fetchJson(url: string) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function loadAllMatches(): Promise<{ matches: KvMatch[]; source: string }> {
  let lastErr: unknown;
  for (const base of KV_BASES) {
    try {
      const index = await fetchJson(`${base.replace(/\/$/, "")}/data/index.json`);
      const months = index.months || [];
      const matches: KvMatch[] = [];
      for (const m of months) {
        const url = String(m.url || "").startsWith("http")
          ? m.url
          : `${base.replace(/\/$/, "")}/${String(m.url || "").replace(/^\//, "")}`;
        const data = await fetchJson(url);
        const year = Number(m.year) || Number(data.year) || 2026;
        const month = Number(m.month) || Number(data.month) || 9;
        for (const match of data.matches || []) {
          matches.push({ ...match, year, month });
        }
      }
      return { matches, source: base };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("KV unavailable");
}

function tally(list: KvMatch[]) {
  const played = list.filter((m) => m.status && m.status !== "upcoming");
  const wins = played.filter((m) => m.status === "win").length;
  const draws = played.filter((m) => m.status === "draw").length;
  const losses = played.filter((m) => m.status === "lose").length;
  const upcoming = list.filter((m) => m.status === "upcoming").length;
  const winrate = played.length ? Math.round((100 * wins) / played.length) : 0;
  return { played: played.length, wins, draws, losses, upcoming, winrate, total: list.length };
}

export async function buildClanKvStats(clanTag: string): Promise<ClanStats> {
  const { matches, source } = await loadAllMatches();
  // Календарь КВ — матчи BlackBerry; для BB/BlackBerry берём всё
  const isBb =
    /^bb$/i.test(clanTag) ||
    /^blackberry$/i.test(clanTag);
  const list = isBb ? matches : matches.filter(() => false);

  const summary = tally(list);
  const stacks = new Map<string, KvMatch[]>();
  for (const m of list) {
    const name = m.stack || "—";
    if (!stacks.has(name)) stacks.set(name, []);
    stacks.get(name)!.push(m);
  }
  const byStack = Array.from(stacks.entries()).map(([name, arr]) => {
    const t = tally(arr);
    return {
      name,
      played: t.played,
      wins: t.wins,
      draws: t.draws,
      losses: t.losses,
      winrate: t.winrate,
    };
  });

  const mapMap = new Map<
    string,
    { map: string; full: string; games: number; wins: number; losses: number; draws: number }
  >();
  for (const m of list) {
    if (!m.status || m.status === "upcoming" || !m.map) continue;
    const key = shortMap(m.map);
    const cur = mapMap.get(key) || {
      map: key,
      full: m.map,
      games: 0,
      wins: 0,
      losses: 0,
      draws: 0,
    };
    cur.games += 1;
    if (m.status === "win") cur.wins += 1;
    else if (m.status === "lose") cur.losses += 1;
    else if (m.status === "draw") cur.draws += 1;
    mapMap.set(key, cur);
  }
  const maps = Array.from(mapMap.values()).sort((a, b) => b.games - a.games);

  const recent = list
    .filter((m) => m.status && m.status !== "upcoming")
    .slice(-8)
    .reverse()
    .map((m) => ({
      day: Number(m.day) || 0,
      opp: m.opp || "—",
      map: shortMap(m.map || "—"),
      stack: m.stack || "—",
      status: m.status || "",
      meeting: m.meeting || "—",
    }));

  return {
    total: summary.total,
    played: summary.played,
    upcoming: summary.upcoming,
    wins: summary.wins,
    draws: summary.draws,
    losses: summary.losses,
    winrate: summary.winrate,
    byStack,
    maps,
    recent,
    source,
  };
}

function n(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function nickEq(a: string, b: string) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Личная стата игрока по раундам из data/players + mvp-ledger */
export async function buildPlayerKvStats(nick: string): Promise<PlayerKvStats> {
  const { matches, source } = await loadAllMatches();
  const base = source.replace(/\/$/, "");
  const want = nick.trim();
  const rounds: PlayerKvRound[] = [];
  const matchMeta = new Map<string, KvMatch>();

  for (const m of matches) {
    const mid = String(m.id || "").trim();
    if (mid) matchMeta.set(mid, m);
    const playersUrl = String(m.playersUrl || "").trim();
    if (!playersUrl || !mid) continue;
    const url = playersUrl.startsWith("http")
      ? playersUrl
      : `${base}/${playersUrl.replace(/^\//, "")}`;
    try {
      const data = await fetchJson(url);
      for (const rnd of ["r1", "r2"] as const) {
        for (const row of data[rnd] || []) {
          if (!nickEq(String(row?.nick || ""), want)) continue;
          rounds.push({
            matchId: mid,
            day: Number(m.day) || Number(data.day) || 0,
            opp: String(m.opp || data.opp || "—"),
            map: shortMap(String(m.map || "—")),
            stack: String(m.stack || "—"),
            status: String(m.status || ""),
            meeting: String(m.meeting || "—"),
            round: rnd,
            kills: n(row.kills),
            deaths: n(row.deaths),
            dmg: n(row.dmg),
            res: n(row.res),
            nok: n(row.nok),
          });
        }
      }
    } catch {
      /* нет файла игроков — пропускаем */
    }
  }

  const matchIds = [...new Set(rounds.map((r) => r.matchId))];
  let wins = 0;
  let draws = 0;
  let losses = 0;
  for (const id of matchIds) {
    const st = matchMeta.get(id)?.status;
    if (st === "win") wins += 1;
    else if (st === "draw") draws += 1;
    else if (st === "lose") losses += 1;
  }
  const playedMatches = wins + draws + losses;
  const kills = rounds.reduce((s, r) => s + r.kills, 0);
  const deaths = rounds.reduce((s, r) => s + r.deaths, 0);
  const dmg = rounds.reduce((s, r) => s + r.dmg, 0);
  const res = rounds.reduce((s, r) => s + r.res, 0);
  const nok = rounds.reduce((s, r) => s + r.nok, 0);

  const stacks = new Map<string, PlayerKvRound[]>();
  for (const r of rounds) {
    const name = r.stack || "—";
    if (!stacks.has(name)) stacks.set(name, []);
    stacks.get(name)!.push(r);
  }
  const byStack = Array.from(stacks.entries()).map(([name, arr]) => ({
    name,
    rounds: arr.length,
    kills: arr.reduce((s, r) => s + r.kills, 0),
    deaths: arr.reduce((s, r) => s + r.deaths, 0),
    dmg: arr.reduce((s, r) => s + r.dmg, 0),
  }));

  let awards: PlayerKvAward[] = [];
  let mvpDamage = 0;
  let mvpKiller = 0;
  let mvpMedic = 0;
  let antiDeath = 0;
  try {
    const ledger = await fetchJson(`${base}/data/mvp-ledger.json`);
    const entry =
      ledger?.players?.[want] ||
      Object.entries(ledger?.players || {}).find(([k]) => nickEq(k, want))?.[1];
    if (entry) {
      mvpDamage = n(entry.mvpDamage);
      mvpKiller = n(entry.mvpKiller);
      mvpMedic = n(entry.mvpMedic);
      antiDeath = n(entry.antiDeath);
      awards = (entry.awards || []).map(
        (a: {
          matchId?: string;
          day?: number;
          opp?: string;
          round?: string;
          type?: string;
          label?: string;
        }) => {
          const matchId = String(a.matchId || "");
          const meta = matchMeta.get(matchId);
          const day = Number(a.day) || Number(meta?.day) || 0;
          const year = Number(meta?.year) || 2026;
          const month = Number(meta?.month) || 9;
          const dateLabel =
            day > 0
              ? `${String(day).padStart(2, "0")}.${String(month).padStart(2, "0")}.${year}`
              : "—";
          return {
            matchId,
            day,
            dateLabel,
            opp: String(a.opp || meta?.opp || "—"),
            round: String(a.round || ""),
            type: String(a.type || ""),
            label: String(a.label || a.type || "Награда"),
          };
        }
      );
    }
  } catch {
    /* ledger optional */
  }

  const recent = [...rounds].sort((a, b) => {
    if (b.day !== a.day) return b.day - a.day;
    return b.round.localeCompare(a.round);
  });

  const byMatch = new Map<string, PlayerKvRound[]>();
  for (const r of rounds) {
    if (!byMatch.has(r.matchId)) byMatch.set(r.matchId, []);
    byMatch.get(r.matchId)!.push(r);
  }
  const recentMatches: PlayerKvMatch[] = Array.from(byMatch.entries())
    .map(([matchId, arr]) => {
      const head = arr[0];
      return {
        matchId,
        day: head.day,
        opp: head.opp,
        map: head.map,
        stack: head.stack,
        status: head.status,
        meeting: head.meeting,
        roundsPlayed: arr.length,
        kills: arr.reduce((s, r) => s + r.kills, 0),
        deaths: arr.reduce((s, r) => s + r.deaths, 0),
        dmg: arr.reduce((s, r) => s + r.dmg, 0),
        res: arr.reduce((s, r) => s + r.res, 0),
        nok: arr.reduce((s, r) => s + r.nok, 0),
      };
    })
    .sort((a, b) => b.day - a.day);

  return {
    nick: want,
    rounds: rounds.length,
    matches: matchIds.length,
    kills,
    deaths,
    dmg,
    res,
    nok,
    kd: deaths > 0 ? Math.round((100 * kills) / deaths) / 100 : kills,
    avgKills: matchIds.length
      ? Math.round((10 * kills) / matchIds.length) / 10
      : 0,
    avgDmg: matchIds.length ? Math.round(dmg / matchIds.length) : 0,
    wins,
    draws,
    losses,
    winrate: playedMatches ? Math.round((100 * wins) / playedMatches) : 0,
    awards,
    mvpDamage,
    mvpKiller,
    mvpMedic,
    antiDeath,
    byStack,
    recent,
    recentMatches,
    source,
  };
}
