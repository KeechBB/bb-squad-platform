import { loadTierIndex } from "@/lib/tiers";

export type MatchPwrDeltaMap = Record<string, number>;

const KV_BASES = [
  process.env.KV_DATA_BASE,
  "https://keechbb.github.io/blackberry-kv",
  "https://kv.bb-squad.ru",
].filter(Boolean) as string[];

const RATING_EXCLUDE = new Set(["shrein"]);

const PWR = {
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
  team?: string;
  won?: boolean;
};

function nickKey(nick: string) {
  return nick.trim().toLowerCase().replace(/\s+/g, " ");
}

function softSat(x: number, mid: number) {
  const v = Math.max(0, x);
  const m = mid || 1;
  return v / (v + m);
}

function calcPwr(row: Agg & { tier: number; winPct: number | null; kd: number }) {
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

  const R = softSat(r, PWR.mRes);
  const N = softSat(n, PWR.mNok);
  const K = softSat(k, PWR.mKill);
  const C = softSat(c, PWR.mDmg);
  const Surv = 1 - softSat(d, PWR.mDeath);

  const s = PWR.support;
  const f = PWR.fight;
  const Support = s.res * R + s.nok * N + s.dmg * C;
  const Fight = f.kill * K + f.nok * N + f.dmg * C + f.res * R;
  const Role =
    PWR.roleMax * Math.max(Support, Fight) +
    PWR.roleAvg * ((Support + Fight) / 2);

  const imp = PWR.impact;
  const Impact = imp.role * Role + imp.surv * Surv + imp.win * w;
  const Conf = g / (g + PWR.confGames);
  const tierMult = PWR.tierMult[row.tier] || PWR.tierMult[4];
  const kdMult = row.kd < 1 ? PWR.kdLowMult : 1;

  let pwr = Math.round(Impact * Conf * 1000 * tierMult * kdMult);
  if (pwr < 0) pwr = 0;
  if (pwr > 1000) pwr = 1000;
  return pwr;
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

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function pwrOf(
  agg: Agg,
  tier: number
): number {
  if (agg.games <= 0) return 0;
  const winPct = Math.round((1000 * agg.wins) / agg.games) / 10;
  const kd = agg.deaths === 0 ? agg.kills : agg.kills / agg.deaths;
  return calcPwr({ ...agg, tier, winPct, kd });
}

function emptyAgg(nick: string): Agg {
  return {
    nick,
    games: 0,
    wins: 0,
    res: 0,
    nok: 0,
    kills: 0,
    deaths: 0,
    dmg: 0,
  };
}

function sumMeetingPlayers(players: {
  r1?: PlayerLine[];
  r2?: PlayerLine[];
  total?: PlayerLine[];
  players?: PlayerLine[];
}): Map<string, { nick: string; res: number; nok: number; kills: number; deaths: number; dmg: number }> {
  const out = new Map<
    string,
    { nick: string; res: number; nok: number; kills: number; deaths: number; dmg: number }
  >();
  const lines =
    players.total?.length || players.players?.length
      ? ([...(players.total || []), ...(players.players || [])] as PlayerLine[])
      : ([...(players.r1 || []), ...(players.r2 || [])] as PlayerLine[]);

  for (const p of lines) {
    const raw = String(p?.nick || "").trim();
    if (!raw) continue;
    const key = nickKey(raw);
    if (!out.has(key)) {
      out.set(key, { nick: raw, res: 0, nok: 0, kills: 0, deaths: 0, dmg: 0 });
    }
    const row = out.get(key)!;
    row.res += Number(p.res) || 0;
    row.nok += Number(p.nok) || 0;
    row.kills += Number(p.kills) || 0;
    row.deaths += Number(p.deaths) || 0;
    row.dmg += Number(p.dmg) || 0;
  }
  return out;
}

async function loadAliases() {
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
  const displayNick = (n: string) => {
    const key = nickKey(n);
    return aliasCanon.get(key) || n.trim();
  };
  return { resolveKey, displayNick };
}

/** Δ PWR каждого игрока за одну встречу КВ (после минус до). */
export async function buildCwMatchPwrDeltas(
  matchId: string
): Promise<MatchPwrDeltaMap> {
  const wantId = String(matchId || "").trim();
  if (!wantId) return {};

  const index = await loadFromKv<{
    months?: { year?: number; month?: number; url?: string }[];
  }>("data/index.json");
  if (!index?.months?.length) return {};

  const { resolveKey, displayNick } = await loadAliases();
  const tierIndex = await loadTierIndex();
  const tierOf = (nick: string) =>
    tierIndex.get(resolveKey(nick)) || tierIndex.get(nickKey(nick)) || 4;

  type Meta = {
    id: string;
    status: string;
    playersUrl: string;
    sortKey: string;
  };
  const metas: Meta[] = [];
  for (const m of index.months) {
    if (!m.url || !m.year || !m.month) continue;
    const monthData = await loadFromKv<{
      matches?: {
        id?: string;
        day?: number;
        status?: string;
        playersUrl?: string;
      }[];
    }>(m.url);
    for (const match of monthData?.matches || []) {
      if (!match.playersUrl || !match.id || match.day == null) continue;
      metas.push({
        id: match.id,
        status: String(match.status || ""),
        playersUrl: match.playersUrl,
        sortKey: `${m.year}-${pad2(m.month)}-${pad2(match.day)}-${match.id}`,
      });
    }
  }
  metas.sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  const aggMap = new Map<string, Agg>();
  const deltas: MatchPwrDeltaMap = {};

  for (const match of metas) {
    const players = await loadFromKv<{
      r1?: PlayerLine[];
      r2?: PlayerLine[];
      total?: PlayerLine[];
      players?: PlayerLine[];
    }>(match.playersUrl);
    if (!players) continue;
    const byNick = sumMeetingPlayers(players);
    if (!byNick.size) continue;

    const status = match.status.toLowerCase();
    const meetingWon =
      status === "win" ? true : status === "lose" ? false : null;
    const isTarget = match.id === wantId;

    if (isTarget) {
      for (const [, p] of byNick) {
        if (RATING_EXCLUDE.has(nickKey(p.nick))) continue;
        const key = resolveKey(p.nick);
        const before = aggMap.get(key) || emptyAgg(displayNick(p.nick));
        const after: Agg = {
          nick: before.nick || displayNick(p.nick),
          games: before.games + 1,
          wins: before.wins + (meetingWon === true ? 1 : 0),
          res: before.res + p.res,
          nok: before.nok + p.nok,
          kills: before.kills + p.kills,
          deaths: before.deaths + p.deaths,
          dmg: before.dmg + p.dmg,
        };
        const tier = tierOf(p.nick);
        const pwrBefore = pwrOf(before, tier);
        const pwrAfter = pwrOf(after, tier);
        deltas[displayNick(p.nick)] = pwrAfter - pwrBefore;
        // also index by raw nick variants
        deltas[p.nick] = pwrAfter - pwrBefore;
      }
      return deltas;
    }

    for (const [, p] of byNick) {
      if (RATING_EXCLUDE.has(nickKey(p.nick))) continue;
      const key = resolveKey(p.nick);
      if (!aggMap.has(key)) {
        aggMap.set(key, emptyAgg(displayNick(p.nick)));
      }
      const row = aggMap.get(key)!;
      row.games += 1;
      if (meetingWon === true) row.wins += 1;
      row.res += p.res;
      row.nok += p.nok;
      row.kills += p.kills;
      row.deaths += p.deaths;
      row.dmg += p.dmg;
    }
  }

  return deltas;
}

/** Δ PWR каждого игрока за одну тренировку. */
export async function buildTrainMatchPwrDeltas(
  matchId: string
): Promise<MatchPwrDeltaMap> {
  const wantId = String(matchId || "").trim();
  if (!wantId) return {};

  const index = await loadFromKv<{
    months?: { year?: number; month?: number; url?: string }[];
  }>("data/training-index.json");
  if (!index?.months?.length) return {};

  const { resolveKey, displayNick } = await loadAliases();
  const tierIndex = await loadTierIndex();
  const tierOf = (nick: string) =>
    tierIndex.get(resolveKey(nick)) || tierIndex.get(nickKey(nick)) || 4;

  type Meta = {
    id: string;
    winner?: string;
    playersUrl: string;
    sortKey: string;
  };
  const metas: Meta[] = [];
  for (const m of index.months) {
    if (!m.url || !m.year || !m.month) continue;
    const monthData = await loadFromKv<{
      matches?: {
        id?: string;
        day?: number;
        winner?: string;
        playersUrl?: string;
      }[];
    }>(m.url);
    for (const match of monthData?.matches || []) {
      if (!match.playersUrl || !match.id || match.day == null) continue;
      metas.push({
        id: match.id,
        winner: match.winner,
        playersUrl: match.playersUrl,
        sortKey: `${m.year}-${pad2(m.month)}-${pad2(match.day)}-${match.id}`,
      });
    }
  }
  metas.sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  const aggMap = new Map<string, Agg>();
  const deltas: MatchPwrDeltaMap = {};

  for (const match of metas) {
    const players = await loadFromKv<{
      players?: PlayerLine[];
      teamA?: PlayerLine[];
      teamB?: PlayerLine[];
      winner?: string;
    }>(match.playersUrl);
    if (!players) continue;
    const list: PlayerLine[] =
      players.players && players.players.length
        ? players.players
        : [...(players.teamA || []), ...(players.teamB || [])];
    if (!list.length) continue;

    const winner = String(match.winner || players.winner || "").toUpperCase();
    const isTarget = match.id === wantId;

    // one entry per nick for this match
    const byNick = new Map<
      string,
      { nick: string; res: number; nok: number; kills: number; deaths: number; dmg: number; won: boolean | null }
    >();
    for (const p of list) {
      const raw = String(p?.nick || "").trim();
      if (!raw) continue;
      const key = resolveKey(raw);
      if (RATING_EXCLUDE.has(nickKey(raw))) continue;
      if (!byNick.has(key)) {
        const teamU = String(p.team || "").toUpperCase();
        const wonExplicit = p.won === true;
        const wonFromWinner =
          Boolean(winner) && Boolean(teamU) && teamU === winner;
        const lostFromWinner =
          Boolean(winner) && Boolean(teamU) && teamU !== winner;
        const won: boolean | null =
          wonExplicit || wonFromWinner
            ? true
            : lostFromWinner
              ? false
              : null;
        byNick.set(key, {
          nick: displayNick(raw),
          res: 0,
          nok: 0,
          kills: 0,
          deaths: 0,
          dmg: 0,
          won,
        });
      }
      const row = byNick.get(key)!;
      row.res += Number(p.res) || 0;
      row.nok += Number(p.nok) || 0;
      row.kills += Number(p.kills) || 0;
      row.deaths += Number(p.deaths) || 0;
      row.dmg += Number(p.dmg) || 0;
    }

    if (isTarget) {
      for (const [key, p] of byNick) {
        const before = aggMap.get(key) || emptyAgg(p.nick);
        const after: Agg = {
          nick: before.nick || p.nick,
          games: before.games + 1,
          wins: before.wins + (p.won === true ? 1 : 0),
          res: before.res + p.res,
          nok: before.nok + p.nok,
          kills: before.kills + p.kills,
          deaths: before.deaths + p.deaths,
          dmg: before.dmg + p.dmg,
        };
        const tier = tierOf(p.nick);
        const delta = pwrOf(after, tier) - pwrOf(before, tier);
        deltas[p.nick] = delta;
      }
      return deltas;
    }

    for (const [key, p] of byNick) {
      if (!aggMap.has(key)) aggMap.set(key, emptyAgg(p.nick));
      const row = aggMap.get(key)!;
      row.games += 1;
      if (p.won === true) row.wins += 1;
      row.res += p.res;
      row.nok += p.nok;
      row.kills += p.kills;
      row.deaths += p.deaths;
      row.dmg += p.dmg;
    }
  }

  return deltas;
}
