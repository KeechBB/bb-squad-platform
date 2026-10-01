/**
 * Training Respect Points (RP) — visible ladder.
 * Hidden PWR is only a weight inside the Die()/give-up formula (see rp-ledger.json).
 */
import { unstable_noStore as noStore } from "next/cache";

const KV_BASES = [
  process.env.KV_DATA_BASE,
  "https://keechbb.github.io/blackberry-kv",
].filter(Boolean) as string[];

export type RpMatchEvent = {
  time: string;
  killer: string;
  victim: string;
  killerPwr: number;
  victimPwr: number;
  delta: number;
};

export type RpPlayerMatch = {
  id: string;
  map: string;
  date: string;
  net: number;
  kills: RpMatchEvent[];
  deaths: RpMatchEvent[];
};

export type RpPlayer = {
  nick: string;
  rp: number;
  rankLabel: string;
  rankKey: string;
  roman?: string;
  predator?: boolean;
  predatorPlace?: number | null;
  matches: RpPlayerMatch[];
};

export type RpLeaderRow = {
  nick: string;
  rp: number;
  rankLabel: string;
  rankKey: string;
  predatorPlace?: number | null;
  place: number;
  games: number;
};

export type RpLedger = {
  version: number;
  startRp: number;
  step: number;
  radiant3Max: number;
  pMax: number;
  matches: {
    id: string;
    map: string;
    date: string;
    netByNick: Record<string, number>;
    events: RpMatchEvent[];
  }[];
  players: Record<string, RpPlayer>;
  leaderboard: Omit<RpLeaderRow, "place" | "games">[];
};

function nickKey(n: string) {
  return String(n || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

async function fetchJson(url: string) {
  const res = await fetch(url, { next: { revalidate: 60 } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function loadRpLedger(): Promise<RpLedger | null> {
  noStore();
  for (const base of KV_BASES) {
    try {
      const data = (await fetchJson(
        `${base.replace(/\/$/, "")}/data/training/rp-ledger.json`
      )) as RpLedger;
      if (data?.players) return data;
    } catch {
      /* next */
    }
  }
  return null;
}

export function rpRankFromScore(rp: number, step = 150, radiant3Max = 4500) {
  const names: [string, string][] = [
    ["Iron", "iron"],
    ["Bronze", "bronze"],
    ["Silver", "silver"],
    ["Gold", "gold"],
    ["Platinum", "platinum"],
    ["Diamond", "diamond"],
    ["Legend", "legend"],
    ["Immortal", "immortal"],
    ["Master", "master"],
    ["Radiant", "radiant"],
  ];
  const roman = ["I", "II", "III"] as const;
  const rpI = Math.round(rp);
  if (rpI > radiant3Max) {
    return { label: "PREDATOR", rankKey: "predator", predator: true as const };
  }
  const idx = rpI < 1 ? 0 : Math.min(29, Math.floor((rpI - 1) / step));
  const [name, key] = names[Math.floor(idx / 3)];
  return {
    label: `${name.toUpperCase()} ${roman[idx % 3]}`,
    rankKey: key,
    predator: false as const,
  };
}

export async function buildTrainRpLeaderboard(): Promise<{
  rows: RpLeaderRow[];
  players: number;
  matches: number;
  updatedAt: string;
}> {
  const ledger = await loadRpLedger();
  if (!ledger?.leaderboard?.length) {
    return { rows: [], players: 0, matches: 0, updatedAt: new Date().toISOString() };
  }
  const rows: RpLeaderRow[] = ledger.leaderboard.map((r, i) => {
    const p = ledger.players[nickKey(r.nick)];
    return {
      nick: r.nick,
      rp: r.rp,
      rankLabel: r.predatorPlace
        ? `PREDATOR #${r.predatorPlace}`
        : r.rankLabel,
      rankKey: r.rankKey,
      predatorPlace: r.predatorPlace ?? null,
      place: i + 1,
      games: p?.matches?.length || 0,
    };
  });
  return {
    rows,
    players: rows.length,
    matches: ledger.matches?.length || 0,
    updatedAt: new Date().toISOString(),
  };
}

export async function lookupPlayerTrainRp(nick: string): Promise<RpPlayer | null> {
  const ledger = await loadRpLedger();
  if (!ledger) return null;
  const key = nickKey(nick);
  const direct = ledger.players[key];
  if (direct) return direct;
  // alias-ish: scan
  for (const p of Object.values(ledger.players)) {
    if (nickKey(p.nick) === key) return p;
  }
  return null;
}

export async function trainMatchRpDeltas(
  matchId: string
): Promise<Record<string, number>> {
  const ledger = await loadRpLedger();
  if (!ledger) return {};
  const m = ledger.matches.find((x) => x.id === matchId);
  if (!m?.netByNick) return {};
  const out: Record<string, number> = {};
  for (const [nick, net] of Object.entries(m.netByNick)) {
    const v = Math.round(Number(net) || 0);
    const low = String(nick || "")
      .trim()
      .toLowerCase();
    if (!low) continue;
    out[low] = v;
    out[nickKey(nick)] = v;
  }
  return out;
}

export type RpMatchListItem = {
  id: string;
  map: string;
  date: string;
  label: string;
};

/** Список тренировочных матчей из RP ledger (новые сверху). */
export async function listRpTrainingMatches(): Promise<RpMatchListItem[]> {
  const ledger = await loadRpLedger();
  if (!ledger?.matches?.length) return [];
  return [...ledger.matches]
    .map((m) => {
      const date = String(m.date || "");
      const map = String(m.map || m.id);
      const short = date.length >= 10 ? date.slice(5).replace("-", ".") : date;
      return {
        id: String(m.id),
        map,
        date,
        label: `${short} · ${map}`,
      };
    })
    .reverse();
}

/** Разбор RP одного игрока в конкретном матче (киллы / смерти / net). */
export async function playerRpMatchBreakdown(
  nick: string,
  matchId: string
): Promise<RpPlayerMatch | null> {
  const ledger = await loadRpLedger();
  if (!ledger) return null;
  const want = nickKey(nick);
  const match = ledger.matches.find((m) => m.id === matchId);
  if (!match) return null;

  const player = ledger.players[want];
  if (player?.matches?.length) {
    const hit = player.matches.find((m) => m.id === matchId);
    if (hit) return hit;
  }

  const kills: RpMatchEvent[] = [];
  const deaths: RpMatchEvent[] = [];
  for (const e of match.events || []) {
    if (nickKey(e.killer) === want) kills.push(e);
    if (nickKey(e.victim) === want) deaths.push(e);
  }
  const netFromMap = match.netByNick
    ? Object.entries(match.netByNick).find(([n]) => nickKey(n) === want)?.[1]
    : null;
  const net =
    netFromMap != null
      ? Number(netFromMap) || 0
      : kills.reduce((s, e) => s + e.delta, 0) -
        deaths.reduce((s, e) => s + Math.abs(e.delta), 0);

  if (!kills.length && !deaths.length && net === 0) return null;

  return {
    id: match.id,
    map: String(match.map || match.id),
    date: String(match.date || ""),
    net,
    kills,
    deaths,
  };
}
