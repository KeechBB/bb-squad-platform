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

export type ClanPlayerAgg = {
  nick: string;
  kills: number;
  deaths: number;
  dmg: number;
  res: number;
  nok: number;
  games: number;
  kd: number;
};

export type ClanCombatStats = {
  kills: number;
  deaths: number;
  dmg: number;
  res: number;
  nok: number;
  kd: number;
  /** средние на матч (сумма команды / сыгранные матчи со статой) */
  avgKills: number;
  avgDeaths: number;
  avgDmg: number;
  avgRes: number;
  /** средние на игрока за матч */
  avgKillsPerPlayer: number;
  avgDmgPerPlayer: number;
  matchesWithStats: number;
  players: number;
};

export type ClanTops = {
  kills: ClanPlayerAgg[];
  kd: ClanPlayerAgg[];
  dmg: ClanPlayerAgg[];
  res: ClanPlayerAgg[];
  mvpKills: { nick: string; n: number }[];
  mvpDmg: { nick: string; n: number }[];
  mvpRes: { nick: string; n: number }[];
};

export type ClanStats = {
  total: number;
  played: number;
  upcoming: number;
  cancelled: number;
  wins: number;
  draws: number;
  losses: number;
  winrate: number;
  byStack: { name: string; played: number; wins: number; draws: number; losses: number; winrate: number }[];
  maps: { map: string; full: string; games: number; wins: number; losses: number; draws: number }[];
  recent: { day: number; opp: string; map: string; stack: string; status: string; meeting: string }[];
  combat: ClanCombatStats | null;
  tops: ClanTops | null;
  source: string;
};

function shortMap(map: string): string {
  let s = map.trim();
  s = s.replace(/^(SEC|BALT|OOTB)\s+/i, "");
  s = s.replace(/^\d+\s+/, "");
  s = s.replace(/\s+(AAS|PAAS|RAAS|TC|Invasion|Seed).*$/i, "");
  s = s.replace(/\s+v\d+$/i, "");
  return s.trim() || map;
}

function toKvRel(pathOrUrl: string): string {
  return String(pathOrUrl || "")
    .replace(/^\//, "")
    .replace(/^https?:\/\/[^/]+\//, "");
}

async function loadKvJson<T = unknown>(relPath: string): Promise<T> {
  const { loadKvJsonCached } = await import("@/lib/kvLocal");
  const rel = toKvRel(relPath);
  const data = await loadKvJsonCached<T>(rel);
  if (data == null) throw new Error(`KV missing on disk: ${rel}`);
  return data;
}

async function loadAllMatches(): Promise<{ matches: KvMatch[]; source: string }> {
  const index = await loadKvJson<{
    months?: { url?: string; year?: number; month?: number }[];
  }>("data/index.json");
  const months = index.months || [];
  const matches: KvMatch[] = [];
  for (const m of months) {
    if (!m.url) continue;
    const data = await loadKvJson<{
      year?: number;
      month?: string | number;
      matches?: KvMatch[];
    }>(m.url);
    const year = Number(m.year) || Number(data.year) || 2026;
    const month =
      Number(m.month) ||
      Number(String(data.month || "").slice(5, 7)) ||
      Number(data.month) ||
      9;
    for (const match of data.matches || []) {
      matches.push({ ...match, year, month });
    }
  }
  return { matches, source: "vps-disk" };
}

function isPlayedStatus(status?: string) {
  return status === "win" || status === "lose" || status === "draw";
}

function tally(list: KvMatch[]) {
  const played = list.filter((m) => isPlayedStatus(m.status));
  const wins = played.filter((m) => m.status === "win").length;
  const draws = played.filter((m) => m.status === "draw").length;
  const losses = played.filter((m) => m.status === "lose").length;
  const upcoming = list.filter((m) => m.status === "upcoming").length;
  const cancelled = list.filter((m) => m.status === "cancel").length;
  const winrate = played.length ? Math.round((100 * wins) / played.length) : 0;
  return {
    played: played.length,
    wins,
    draws,
    losses,
    upcoming,
    cancelled,
    winrate,
    total: list.length,
  };
}

function matchSortKey(m: KvMatch): number {
  const y = Number(m.year) || 0;
  const mo = Number(m.month) || 0;
  const d = Number(m.day) || 0;
  return y * 10000 + mo * 100 + d;
}

function oppTagMatch(opp: string | undefined, clanTag: string): boolean {
  const a = String(opp || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const b = String(clanTag || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (!a || !b) return false;
  if (a === b) return true;
  // aliases: 20royals↔20r, falcons↔fal, redfoxes↔fox, .solid↔solid
  const aliases: Record<string, string> = {
    "20royals": "20r",
    falcons: "fal",
    redfoxes: "fox",
    foxes: "fox",
    avanguard: "avg",
    solid: "solid",
  };
  const na = aliases[a] || a;
  const nb = aliases[b] || b;
  return na === nb;
}

/** Календарь с точки зрения BB: win = победа BB. Для чужого клана инвертируем. */
function invertBbStatus(status?: string): string {
  if (status === "win") return "lose";
  if (status === "lose") return "win";
  return status || "";
}

function invertMeeting(meeting?: string): string {
  const m = String(meeting || "").trim();
  const hit = m.match(/^(\d+)\s*[–\-—:]\s*(\d+)/);
  if (!hit) return m || "—";
  return `${hit[2]}–${hit[1]}`;
}

/** Состав BB, против которого играл соперник: «BB Main» / «BB Junior». */
function bbStackLabel(stack?: string | null): string {
  const s = String(stack || "").trim();
  if (!s || s === "—") return "BB";
  const low = s.toLowerCase();
  if (low === "main") return "BB Main";
  if (low === "junior") return "BB Junior";
  return `BB ${s}`;
}

export async function buildClanKvStats(clanTag: string): Promise<ClanStats> {
  const { matches, source } = await loadAllMatches();
  // Календарь КВ — матчи BlackBerry; для BB/BlackBerry берём всё;
  // для чужого клана — слоты где opp совпал (статус с их стороны).
  const isBb =
    /^bb$/i.test(clanTag) ||
    /^blackberry$/i.test(clanTag);
  const list = isBb
    ? matches
    : matches
        .filter((m) => oppTagMatch(m.opp, clanTag))
        .map((m) => ({
          ...m,
          status: invertBbStatus(m.status),
          meeting: invertMeeting(m.meeting),
          // для соперника «против кого» = состав BB (Main/Junior)
          opp:
            isPlayedStatus(m.status) ||
            m.status === "upcoming" ||
            m.status === "cancel"
              ? bbStackLabel(m.stack)
              : m.opp,
        }));

  const summary = tally(list);
  // «По составам» имеет смысл только у BB (наши Main/Junior).
  // У DCAI и др. это составы BB, не их — не показываем.
  let byStack: ClanStats["byStack"] = [];
  if (isBb) {
    const stacks = new Map<string, KvMatch[]>();
    for (const m of list) {
      const name = m.stack || "—";
      if (!stacks.has(name)) stacks.set(name, []);
      stacks.get(name)!.push(m);
    }
    byStack = Array.from(stacks.entries())
      .map(([name, arr]) => {
        const t = tally(arr);
        return {
          name,
          played: t.played,
          wins: t.wins,
          draws: t.draws,
          losses: t.losses,
          winrate: t.winrate,
        };
      })
      .sort((a, b) => {
        const order = (n: string) =>
          n.toLowerCase() === "main" ? 0 : n.toLowerCase() === "junior" ? 1 : 2;
        return order(a.name) - order(b.name) || a.name.localeCompare(b.name, "ru");
      });
  }

  const mapMap = new Map<
    string,
    { map: string; full: string; games: number; wins: number; losses: number; draws: number }
  >();
  for (const m of list) {
    if (!m.status || !isPlayedStatus(m.status) || !m.map) continue;
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
  const maps = Array.from(mapMap.values()).sort(
    (a, b) => b.games - a.games || a.map.localeCompare(b.map, "ru")
  );

  const recent = list
    .filter((m) => m.status && m.status !== "upcoming")
    .slice()
    .sort((a, b) => matchSortKey(b) - matchSortKey(a))
    .slice(0, 16)
    .map((m) => ({
      day: Number(m.day) || 0,
      opp: m.opp || "—",
      map: shortMap(m.map || "—"),
      stack: m.stack || "—",
      status: m.status || "",
      meeting: m.meeting || "—",
    }));

  const { combat, tops } = await aggregateClanCombat(list, isBb);

  return {
    total: summary.total,
    played: summary.played,
    upcoming: summary.upcoming,
    cancelled: summary.cancelled,
    wins: summary.wins,
    draws: summary.draws,
    losses: summary.losses,
    winrate: summary.winrate,
    byStack,
    maps,
    recent,
    combat,
    tops,
    source,
  };
}

type CombatRow = {
  nick: string;
  kills: number;
  deaths: number;
  dmg: number;
  res: number;
  nok: number;
};

function bumpMvp(
  map: Map<string, { nick: string; n: number }>,
  nick: string
) {
  const key = nickKeyCompact(nickBase(nick) || nick);
  if (!key) return;
  const cur = map.get(key) || { nick, n: 0 };
  cur.n += 1;
  if (nick.length > cur.nick.length) cur.nick = nick;
  map.set(key, cur);
}

function topMvpNick(rows: CombatRow[], field: keyof CombatRow): string | null {
  let best: CombatRow | null = null;
  for (const r of rows) {
    const v = Number(r[field]) || 0;
    if (!best || v > (Number(best[field]) || 0)) best = r;
  }
  if (!best || (Number(best[field]) || 0) <= 0) return null;
  return best.nick;
}

/** Боевая стата клана по playersUrl (BB = r1/r2, соперник = oppR1/oppR2). */
async function aggregateClanCombat(
  list: KvMatch[],
  isBb: boolean
): Promise<{ combat: ClanCombatStats | null; tops: ClanTops | null }> {
  const played = list.filter((m) => isPlayedStatus(m.status));
  type Acc = {
    nick: string;
    kills: number;
    deaths: number;
    dmg: number;
    res: number;
    nok: number;
    games: number;
  };
  const byPlayer = new Map<string, Acc>();
  const mvpK = new Map<string, { nick: string; n: number }>();
  const mvpD = new Map<string, { nick: string; n: number }>();
  const mvpR = new Map<string, { nick: string; n: number }>();
  let matchesWithStats = 0;
  let teamKills = 0;
  let teamDeaths = 0;
  let teamDmg = 0;
  let teamRes = 0;
  let teamNok = 0;
  let playerMatchAppearances = 0;

  for (const m of played) {
    const playersUrl = String(m.playersUrl || "").trim();
    if (!playersUrl) continue;
    try {
      const data = await loadKvJson<{
        r1?: Record<string, unknown>[];
        r2?: Record<string, unknown>[];
        oppR1?: Record<string, unknown>[];
        oppR2?: Record<string, unknown>[];
        total?: Record<string, unknown>[];
        players?: Record<string, unknown>[];
      }>(playersUrl);

      const roundSets: Record<string, unknown>[][] = isBb
        ? [data.r1 || [], data.r2 || []]
        : [data.oppR1 || [], data.oppR2 || []];

      // fallback: total/players только для BB (там наша сторона)
      const useFallback =
        isBb &&
        !roundSets[0].length &&
        !roundSets[1].length &&
        Boolean((data.total || data.players || []).length);

      const matchAgg = new Map<string, CombatRow>();

      const ingestRows = (rows: Record<string, unknown>[]) => {
        for (const row of rows) {
          const nick = String(row?.nick || "").trim();
          if (!nick) continue;
          const key = nickKeyCompact(nickBase(nick) || nick);
          const cur = matchAgg.get(key) || {
            nick,
            kills: 0,
            deaths: 0,
            dmg: 0,
            res: 0,
            nok: 0,
          };
          cur.kills += n(row.kills);
          cur.deaths += n(row.deaths);
          cur.dmg += n(row.dmg);
          cur.res += n(row.res);
          cur.nok += n(row.nok);
          if (nick.length > cur.nick.length) cur.nick = nick;
          matchAgg.set(key, cur);
        }
      };

      if (useFallback) {
        ingestRows(data.total || data.players || []);
      } else {
        for (const rows of roundSets) {
          if (!rows.length) continue;
          const roundRows: CombatRow[] = [];
          for (const row of rows) {
            const nick = String(row?.nick || "").trim();
            if (!nick) continue;
            roundRows.push({
              nick,
              kills: n(row.kills),
              deaths: n(row.deaths),
              dmg: n(row.dmg),
              res: n(row.res),
              nok: n(row.nok),
            });
          }
          const mk = topMvpNick(roundRows, "kills");
          const md = topMvpNick(roundRows, "dmg");
          const mr = topMvpNick(roundRows, "res");
          if (mk) bumpMvp(mvpK, mk);
          if (md) bumpMvp(mvpD, md);
          if (mr) bumpMvp(mvpR, mr);
          ingestRows(rows);
        }
      }

      if (!matchAgg.size) continue;
      matchesWithStats += 1;
      for (const row of matchAgg.values()) {
        teamKills += row.kills;
        teamDeaths += row.deaths;
        teamDmg += row.dmg;
        teamRes += row.res;
        teamNok += row.nok;
        playerMatchAppearances += 1;
        const key = nickKeyCompact(nickBase(row.nick) || row.nick);
        const cur = byPlayer.get(key) || {
          nick: row.nick,
          kills: 0,
          deaths: 0,
          dmg: 0,
          res: 0,
          nok: 0,
          games: 0,
        };
        cur.kills += row.kills;
        cur.deaths += row.deaths;
        cur.dmg += row.dmg;
        cur.res += row.res;
        cur.nok += row.nok;
        cur.games += 1;
        if (row.nick.length > cur.nick.length) cur.nick = row.nick;
        byPlayer.set(key, cur);
      }
    } catch {
      /* skip */
    }
  }

  if (!matchesWithStats || !byPlayer.size) {
    return { combat: null, tops: null };
  }

  const players = Array.from(byPlayer.values()).map((p) => ({
    nick: p.nick,
    kills: p.kills,
    deaths: p.deaths,
    dmg: p.dmg,
    res: p.res,
    nok: p.nok,
    games: p.games,
    kd:
      p.deaths > 0
        ? Math.round((100 * p.kills) / p.deaths) / 100
        : p.kills,
  }));

  const sortTop = (
    arr: ClanPlayerAgg[],
    key: keyof ClanPlayerAgg,
    minGames = 1
  ) =>
    [...arr]
      .filter((p) => p.games >= minGames)
      .sort(
        (a, b) =>
          Number(b[key]) - Number(a[key]) ||
          b.games - a.games ||
          a.nick.localeCompare(b.nick, "ru")
      )
      .slice(0, 5);

  const mvpList = (map: Map<string, { nick: string; n: number }>) =>
    [...map.values()]
      .sort((a, b) => b.n - a.n || a.nick.localeCompare(b.nick, "ru"))
      .slice(0, 5);

  const r1 = (v: number) => Math.round(v * 10) / 10;
  const combat: ClanCombatStats = {
    kills: teamKills,
    deaths: teamDeaths,
    dmg: teamDmg,
    res: teamRes,
    nok: teamNok,
    kd:
      teamDeaths > 0
        ? Math.round((100 * teamKills) / teamDeaths) / 100
        : teamKills,
    avgKills: r1(teamKills / matchesWithStats),
    avgDeaths: r1(teamDeaths / matchesWithStats),
    avgDmg: Math.round(teamDmg / matchesWithStats),
    avgRes: r1(teamRes / matchesWithStats),
    avgKillsPerPlayer: playerMatchAppearances
      ? r1(teamKills / playerMatchAppearances)
      : 0,
    avgDmgPerPlayer: playerMatchAppearances
      ? Math.round(teamDmg / playerMatchAppearances)
      : 0,
    matchesWithStats,
    players: players.length,
  };

  const tops: ClanTops = {
    kills: sortTop(players, "kills"),
    kd: sortTop(players, "kd", 2),
    dmg: sortTop(players, "dmg"),
    res: sortTop(players, "res"),
    mvpKills: mvpList(mvpK),
    mvpDmg: mvpList(mvpD),
    mvpRes: mvpList(mvpR),
  };

  return { combat, tops };
}

function n(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

/** Снять клан-теги ↯DCAI↯ / 『DCAI』 / [BB] / DCI)(AG … */
function stripClanDecor(nick: string): string {
  return String(nick || "")
    .replace(/↯[^↯]*↯/g, " ")
    .replace(/『[^』]*』/g, " ")
    .replace(/\[[^\]]*]/g, " ")
    .replace(/DCI\)\(AG/gi, " ")
    .replace(/[|/\\|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function nickBase(nick: string): string {
  return stripClanDecor(nick)
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nickEq(a: string, b: string) {
  const na = a.trim().toLowerCase();
  const nb = b.trim().toLowerCase();
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.replace(/\s+/g, "") === nb.replace(/\s+/g, "")) return true;
  const sa = stripClanDecor(a);
  const sb = stripClanDecor(b);
  if (sa && sb && (sa === sb || sa.replace(/\s+/g, "") === sb.replace(/\s+/g, ""))) {
    return true;
  }
  const ba = nickBase(a);
  const bb = nickBase(b);
  return Boolean(ba && bb && ba === bb);
}

function nickKeyCompact(nick: string): string {
  return nick.trim().toLowerCase().replace(/\s+/g, "");
}

/** TU по всем сыгранным КВ: (киллы + ресы − смерти) / катки. */
export async function computeCwTuByNick(): Promise<Map<string, number>> {
  const { matches } = await loadAllMatches();
  const acc = new Map<
    string,
    { kills: number; deaths: number; res: number; games: number }
  >();

  for (const m of matches) {
    if (!isPlayedStatus(m.status)) continue;
    const playersUrl = String(m.playersUrl || "").trim();
    if (!playersUrl) continue;
    try {
      type Row = { nick?: string; kills?: unknown; deaths?: unknown; res?: unknown };
      const data = await loadKvJson<{
        total?: Row[];
        players?: Row[];
        r1?: Row[];
        r2?: Row[];
        oppR1?: Row[];
        oppR2?: Row[];
      }>(playersUrl);

      const rows =
        data.total ||
        data.players ||
        (() => {
          const by = new Map<
            string,
            { nick: string; kills: number; deaths: number; res: number }
          >();
          for (const rnd of [
            ...(data.r1 || []),
            ...(data.r2 || []),
            ...(data.oppR1 || []),
            ...(data.oppR2 || []),
          ]) {
            const nick = String(rnd?.nick || "").trim();
            if (!nick) continue;
            const key = nickKeyCompact(nickBase(nick) || nick);
            const cur = by.get(key) || { nick, kills: 0, deaths: 0, res: 0 };
            cur.kills += n(rnd.kills);
            cur.deaths += n(rnd.deaths);
            cur.res += n(rnd.res);
            by.set(key, cur);
          }
          return [...by.values()];
        })();

      const seen = new Set<string>();
      for (const row of rows) {
        const nick = String(row?.nick || "").trim();
        if (!nick) continue;
        const key = nickKeyCompact(nickBase(nick) || nick);
        if (seen.has(key)) continue;
        seen.add(key);
        const cur = acc.get(key) || { kills: 0, deaths: 0, res: 0, games: 0 };
        cur.kills += n(row.kills);
        cur.deaths += n(row.deaths);
        cur.res += n(row.res);
        cur.games += 1;
        acc.set(key, cur);
      }
    } catch {
      /* skip missing players file */
    }
  }

  const out = new Map<string, number>();
  for (const [key, c] of acc) {
    if (c.games <= 0) continue;
    const tu = Math.round((100 * (c.kills + c.res - c.deaths)) / c.games) / 100;
    out.set(key, tu);
  }
  return out;
}

/** Личная стата игрока по раундам из data/players + mvp-ledger */
export async function buildPlayerKvStats(nick: string): Promise<PlayerKvStats> {
  const { matches, source } = await loadAllMatches();
  const want = nick.trim();
  const rounds: PlayerKvRound[] = [];
  const matchMeta = new Map<string, KvMatch>();

  type PlayersDoc = {
    day?: number;
    opp?: string;
    r1?: Record<string, unknown>[];
    r2?: Record<string, unknown>[];
    oppR1?: Record<string, unknown>[];
    oppR2?: Record<string, unknown>[];
  };

  const jobs: { m: KvMatch; mid: string; playersUrl: string }[] = [];
  for (const m of matches) {
    const mid = String(m.id || "").trim();
    if (mid) matchMeta.set(mid, m);
    const playersUrl = String(m.playersUrl || "").trim();
    if (!playersUrl || !mid) continue;
    jobs.push({ m, mid, playersUrl });
  }

  const CONCURRENCY = 16;
  const docs: (PlayersDoc | null)[] = new Array(jobs.length).fill(null);
  for (let i = 0; i < jobs.length; i += CONCURRENCY) {
    const slice = jobs.slice(i, i + CONCURRENCY);
    const loaded = await Promise.all(
      slice.map((j) => loadKvJson<PlayersDoc>(j.playersUrl).catch(() => null))
    );
    for (let k = 0; k < loaded.length; k++) docs[i + k] = loaded[k];
  }

  for (let i = 0; i < jobs.length; i++) {
    const { m, mid } = jobs[i];
    const data = docs[i];
    if (!data) continue;
    const sides: Array<{
      key: "r1" | "r2";
      rows: Record<string, unknown>[] | undefined;
      asOpp: boolean;
    }> = [
      { key: "r1", rows: data.r1, asOpp: false },
      { key: "r2", rows: data.r2, asOpp: false },
      { key: "r1", rows: data.oppR1, asOpp: true },
      { key: "r2", rows: data.oppR2, asOpp: true },
    ];
    for (const side of sides) {
      for (const row of side.rows || []) {
        if (!nickEq(String(row?.nick || ""), want)) continue;
        const status = side.asOpp
          ? invertBbStatus(String(m.status || ""))
          : String(m.status || "");
        const meeting = side.asOpp
          ? invertMeeting(String(m.meeting || "—"))
          : String(m.meeting || "—");
        rounds.push({
          matchId: mid,
          day: Number(m.day) || Number(data.day) || 0,
          // для игрока соперника «противник» = BB
          opp: side.asOpp ? "BB" : String(m.opp || data.opp || "—"),
          map: shortMap(String(m.map || "—")),
          stack: String(m.stack || "—"),
          status,
          meeting,
          round: side.key,
          kills: n(row.kills),
          deaths: n(row.deaths),
          dmg: n(row.dmg),
          res: n(row.res),
          nok: n(row.nok),
        });
      }
    }
  }

  const matchIds = [...new Set(rounds.map((r) => r.matchId))];
  let wins = 0;
  let draws = 0;
  let losses = 0;
  for (const id of matchIds) {
    // раунды соперника уже с invertBbStatus в status поля раунда
    const sample = rounds.find((r) => r.matchId === id);
    const st = sample?.status || matchMeta.get(id)?.status;
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
    type LedgerPlayer = {
      mvpDamage?: unknown;
      mvpKiller?: unknown;
      mvpMedic?: unknown;
      antiDeath?: unknown;
      awards?: {
        matchId?: string;
        day?: number;
        opp?: string;
        round?: string;
        type?: string;
        label?: string;
      }[];
    };
    const ledger = await loadKvJson<{
      players?: Record<string, LedgerPlayer>;
    }>("data/mvp-ledger.json");
    const entry =
      ledger?.players?.[want] ||
      Object.entries(ledger?.players || {}).find(([k]) => nickEq(k, want))?.[1];
    if (entry) {
      mvpDamage = n(entry.mvpDamage);
      mvpKiller = n(entry.mvpKiller);
      mvpMedic = n(entry.mvpMedic);
      antiDeath = n(entry.antiDeath);
      awards = (entry.awards || []).map(
        (a) => {
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
