export type KvMatch = {
  day?: number;
  opp?: string;
  map?: string;
  stack?: string;
  status?: string;
  meeting?: string;
  size?: string;
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
        for (const match of data.matches || []) matches.push(match);
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
