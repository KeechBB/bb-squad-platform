/**
 * Training Respect Points (RP) — visible ladder.
 * Hidden PWR is only a weight inside Die()/revive formulas (see rp-ledger.json).
 *
 * Hot paths use slim `rp-ladder.json` (~0.2MB). Full `rp-ledger.json` (~4MB)
 * is only for drilldown / event times. Prefer local VPS cache over github.io.
 */
import { loadKvJsonCached } from "@/lib/kvLocal";
import {
  sortRpMatchesNewestFirst,
  sortRpMatchesOldestFirst,
} from "@/lib/rpMatchSort";

export {
  rpMatchSortKey,
  sortRpMatchesNewestFirst,
  sortRpMatchesOldestFirst,
} from "@/lib/rpMatchSort";

export type RpMatchEvent = {
  time: string;
  /** Killer (Die/TK) or medic (Revive) */
  killer: string;
  /** Victim (Die/TK) or patient (Revive) */
  victim: string;
  killerPwr: number;
  victimPwr: number;
  delta: number;
  kind?:
    | "die"
    | "tk"
    | "revive"
    | "nok"
    | "vehicle_kill"
    | "vehicle_loss"
    | "vehicle_loss_driver"
    | "driver_share";
  teamkill?: boolean;
  /** Victim loss on nok (v2). */
  victimDelta?: number;
  dmg?: number;
  tickets?: number;
  vehicle?: string;
  weapon?: string;
  seat?: number;
  /** Human label for detail UI («потеря танк T72 (F2)»). */
  label?: string;
  reason?: string;
};

export {
  formatRpEventLabel,
  isVehicleRpEvent,
  vehicleClassRu,
  vehicleLabelRu,
  vehicleShortName,
} from "@/lib/rpVehicleLabels";

export type RpPlayerMatch = {
  id: string;
  map: string;
  date: string;
  /** Start time HH:MM for chronology. Training ids have no clock in the id. */
  time?: string;
  net: number;
  /** Enemy final kills (gained) */
  kills: RpMatchEvent[];
  /** Final deaths — enemy or TK victim (lost) */
  deaths: RpMatchEvent[];
  /** Own teamkills as killer (lost) */
  teamkills?: RpMatchEvent[];
  /** Medic revives this player performed (patient in victim field) */
  revives?: RpMatchEvent[];
  /** Knockdowns dealt (Wound). RP from cutover. */
  noks?: RpMatchEvent[];
  /** Knockdowns received (Wound as victim). */
  gotNoks?: RpMatchEvent[];
  /**
   * Vehicle RP rows for the drilldown «техника» column:
   * vehicle_kill (+) and vehicle_loss / vehicle_loss_driver (−).
   * Not kills and not infantry deaths.
   */
  vehicles?: RpMatchEvent[];
  /** Public: combat damage from KillingDamage on enemy Die/nok (TK excluded). */
  dmg?: number;
  /** Match net RP (slim public ladder). */
  net?: number;
  /** Public PB1: won the layer (from team assignment) */
  won?: boolean | null;
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
  /** Public: rating epoch YYYY-MM-DD (ignore older log matches). */
  epoch?: string;
  /** Public: only matches linked to site match history. */
  historyOnly?: boolean;
  updatedAt?: string;
  matches: {
    id: string;
    map: string;
    date: string;
    netByNick: Record<string, number>;
    events: RpMatchEvent[];
    giveUpKills?: number;
    teamkills?: number;
    revives?: number;
  }[];
  players: Record<string, RpPlayer>;
  leaderboard: Omit<RpLeaderRow, "place" | "games">[];
};

/** Slim ladder — no Die/Revive event arrays. */
export type RpLadder = {
  version: number;
  startRp: number;
  step: number;
  radiant3Max: number;
  pMax: number;
  updatedAt?: string;
  matches: {
    id: string;
    map: string;
    date: string;
    netByNick: Record<string, number>;
    giveUpKills?: number;
    teamkills?: number;
    revives?: number;
  }[];
  players: Record<
    string,
    {
      nick: string;
      rp: number;
      rankLabel: string;
      rankKey: string;
      roman?: string;
      predator?: boolean;
      predatorPlace?: number | null;
      matches: { id: string; map: string; date: string; net: number }[];
    }
  >;
  leaderboard: Omit<RpLeaderRow, "place" | "games">[];
};

const LEDGER_TTL_MS = 90_000;
const LADDER_TTL_MS = 90_000;
const FULL_PLAYER_TTL_MS = 120_000;
let ledgerMem: { at: number; data: RpLedger | null } | null = null;
let ladderMem: { at: number; data: RpLadder | null } | null = null;
/** Extracted full player slices — avoid re-walking ledger.players for drilldown. */
const fullPlayerMem = new Map<string, { at: number; data: RpPlayer | null }>();

function nickKey(n: string) {
  return String(n || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

/** 00:00–00:29 → 24:xx so a match after midnight stays after the evening ones. */
export function trainSortTime(raw?: string): string {
  const hm = /^(\d{1,2}):(\d{2})/.exec(String(raw || "").trim());
  if (!hm) return "";
  let h = Number(hm[1]);
  const mi = Number(hm[2]);
  if (h === 0 && mi <= 29) h = 24;
  return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
}

let trainTimesMem: { at: number; map: Map<string, string> } | null = null;

/** id → start time from the training calendar (data/training/*.json). */
export async function trainMatchTimeById(): Promise<Map<string, string>> {
  const now = Date.now();
  if (trainTimesMem && now - trainTimesMem.at < LADDER_TTL_MS) {
    return trainTimesMem.map;
  }
  const map = new Map<string, string>();
  const index = await loadKvJsonCached<{
    months?: { url?: string }[];
  }>("data/training-index.json");
  for (const month of index?.months || []) {
    if (!month.url) continue;
    const doc = await loadKvJsonCached<{
      matches?: { id?: string; timeMsk?: string }[];
    }>(month.url.replace(/^\//, ""));
    for (const match of doc?.matches || []) {
      const id = String(match.id || "");
      const time = trainSortTime(match.timeMsk);
      if (id && time) map.set(id, time);
    }
  }
  trainTimesMem = { at: now, map };
  return map;
}

export async function withTrainMatchTimes<T extends { id: string; time?: string }>(
  matches: T[]
): Promise<T[]> {
  if (!matches.length) return matches;
  const times = await trainMatchTimeById();
  if (!times.size) return matches;
  return matches.map((m) => {
    const time = times.get(m.id);
    return time ? { ...m, time } : m;
  });
}

function slimPlayerToRp(p: RpLadder["players"][string]): RpPlayer {
  return {
    nick: p.nick,
    rp: p.rp,
    rankLabel: p.rankLabel,
    rankKey: p.rankKey,
    roman: p.roman,
    predator: p.predator,
    predatorPlace: p.predatorPlace,
    matches: (p.matches || []).map((m) => ({
      id: m.id,
      map: m.map,
      date: m.date,
      net: m.net,
      kills: [],
      deaths: [],
      teamkills: [],
      revives: [],
    })),
  };
}

/** Full ledger (~4MB) — drilldown / event timestamps only. */
export async function loadRpLedger(): Promise<RpLedger | null> {
  const now = Date.now();
  if (ledgerMem && now - ledgerMem.at < LEDGER_TTL_MS) {
    return ledgerMem.data;
  }
  const data = await loadKvJsonCached<RpLedger>(
    "data/training/rp-ledger.json"
  );
  const ok = data?.players ? data : null;
  ledgerMem = { at: now, data: ok };
  return ok;
}

/** Cron/worker warm: slim train ladder (+ optional ledger) into RAM. */
export async function warmTrainRpCaches(): Promise<{
  ladder: boolean;
  ledger: boolean;
  players: number;
}> {
  const [ladder, ledger] = await Promise.all([loadRpLadder(), loadRpLedger()]);
  return {
    ladder: Boolean(ladder?.leaderboard?.length || ladder?.players),
    ledger: Boolean(ledger?.players),
    players: ladder?.leaderboard?.length || Object.keys(ladder?.players || {}).length,
  };
}

/** Slim ladder (~0.2MB) — home / TM / profile header / match ΔRP. */
export async function loadRpLadder(): Promise<RpLadder | null> {
  const now = Date.now();
  if (ladderMem && now - ladderMem.at < LADDER_TTL_MS) {
    return ladderMem.data;
  }
  try {
    const { loadRpLadderFromDb } = await import("@/lib/rpDbRead");
    const fromDb = await loadRpLadderFromDb("TRAIN");
    if (fromDb?.players && Object.keys(fromDb.players).length) {
      ladderMem = { at: now, data: fromDb };
      return fromDb;
    }
  } catch {
    /* file fallback */
  }
  let data = await loadKvJsonCached<RpLadder>(
    "data/training/rp-ladder.json"
  );
  // Fallback: derive slim view from full ledger if ladder not published yet.
  if (!data?.players) {
    const full = await loadRpLedger();
    if (full?.players) {
      data = {
        version: full.version,
        startRp: full.startRp,
        step: full.step,
        radiant3Max: full.radiant3Max,
        pMax: full.pMax,
        updatedAt: full.updatedAt,
        matches: (full.matches || []).map((m) => ({
          id: m.id,
          map: m.map,
          date: m.date,
          netByNick: m.netByNick || {},
          giveUpKills: m.giveUpKills,
          teamkills: m.teamkills,
          revives: m.revives,
        })),
        players: Object.fromEntries(
          Object.entries(full.players).map(([k, p]) => [
            k,
            {
              nick: p.nick,
              rp: p.rp,
              rankLabel: p.rankLabel,
              rankKey: p.rankKey,
              roman: p.roman,
              predator: p.predator,
              predatorPlace: p.predatorPlace,
              matches: (p.matches || []).map((m) => ({
                id: m.id,
                map: m.map,
                date: m.date,
                net: m.net,
              })),
            },
          ])
        ),
        leaderboard: full.leaderboard || [],
      };
    }
  }
  const ok = data?.players ? data : null;
  ladderMem = { at: now, data: ok };
  return ok;
}

/** radiant3Max = ceiling before Predator (legacy name; Eclipse III ends here). */
export function rpRankFromScore(rp: number, step = 150, radiant3Max = 4950) {
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
    ["Eclipse", "eclipse"],
  ];
  const roman = ["I", "II", "III"] as const;
  const namedLevels = names.length * 3;
  const rpI = Math.round(rp);
  if (rpI > radiant3Max) {
    return { label: "PREDATOR", rankKey: "predator", predator: true as const };
  }
  const idx =
    rpI < 1 ? 0 : Math.min(namedLevels - 1, Math.floor((rpI - 1) / step));
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
  const ledger = await loadRpLadder();
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

/**
 * Player RP card. Default = slim ladder (no events).
 * Pass `{ full: true }` for drilldown API (kills/deaths/revives).
 */
export async function lookupPlayerTrainRp(
  nick: string,
  opts?: { full?: boolean }
): Promise<RpPlayer | null> {
  const key = nickKey(nick);
  if (opts?.full) {
    const hit = fullPlayerMem.get(key);
    if (hit && Date.now() - hit.at < FULL_PLAYER_TTL_MS) return hit.data;

    const ledger = await loadRpLedger();
    if (!ledger) {
      fullPlayerMem.set(key, { at: Date.now(), data: null });
      return null;
    }
    let found: RpPlayer | null = ledger.players[key] || null;
    if (!found) {
      for (const p of Object.values(ledger.players)) {
        if (nickKey(p.nick) === key) {
          found = p;
          break;
        }
      }
    }
    if (found?.matches?.length) {
      found = {
        ...found,
        matches: sortRpMatchesOldestFirst(
          await withTrainMatchTimes(found.matches)
        ),
      };
    }
    fullPlayerMem.set(key, { at: Date.now(), data: found });
    if (fullPlayerMem.size > 200) {
      const drop = [...fullPlayerMem.entries()]
        .sort((a, b) => a[1].at - b[1].at)
        .slice(0, 60);
      for (const [k] of drop) fullPlayerMem.delete(k);
    }
    return found;
  }

  const ladder = await loadRpLadder();
  if (!ladder) return null;
  const wrap = async (p: RpLadder["players"][string]) => {
    const slim = slimPlayerToRp(p);
    slim.matches = sortRpMatchesOldestFirst(
      await withTrainMatchTimes(slim.matches || [])
    );
    return slim;
  };
  const direct = ladder.players[key];
  if (direct) return wrap(direct);
  for (const p of Object.values(ladder.players)) {
    if (nickKey(p.nick) === key) return wrap(p);
  }
  return null;
}

export async function trainMatchRpDeltas(
  matchId: string
): Promise<Record<string, number>> {
  const ledger = await loadRpLadder();
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

/** Список тренировочных матчей из RP ladder (новые сверху). */
export async function listRpTrainingMatches(): Promise<RpMatchListItem[]> {
  const ledger = await loadRpLadder();
  if (!ledger?.matches?.length) return [];
  return sortRpMatchesNewestFirst(ledger.matches).map((m) => {
    const date = String(m.date || "");
    const map = String(m.map || m.id);
    const short = date.length >= 10 ? date.slice(5).replace("-", ".") : date;
    return {
      id: String(m.id),
      map,
      date,
      label: `${short} · ${map}`,
    };
  });
}

/** Разбор RP одного игрока в конкретном матче (киллы / смерти / ресы / net). */
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
    if (hit) {
      // Старые ledger: driver_share(nok) лежали в kills — разводим в столбики.
      const rawKills = hit.kills || [];
      const shareNoks = rawKills.filter(
        (e) => e.kind === "driver_share" && e.reason === "nok"
      );
      const kills = rawKills.filter(
        (e) => !(e.kind === "driver_share" && e.reason === "nok")
      );
      return {
        ...hit,
        kills,
        noks: [...(hit.noks || []), ...shareNoks],
        gotNoks: hit.gotNoks || [],
        teamkills: hit.teamkills || [],
        revives: hit.revives || [],
      };
    }
  }

  const kills: RpMatchEvent[] = [];
  const deaths: RpMatchEvent[] = [];
  const teamkills: RpMatchEvent[] = [];
  const revives: RpMatchEvent[] = [];
  const noks: RpMatchEvent[] = [];
  const gotNoks: RpMatchEvent[] = [];
  for (const e of match.events || []) {
    const kind = e.kind || "die";
    if (kind === "revive") {
      if (nickKey(e.killer) === want) revives.push(e);
      continue;
    }
    if (kind === "tk") {
      if (nickKey(e.killer) === want) teamkills.push(e);
      if (nickKey(e.victim) === want) deaths.push(e);
      continue;
    }
    if (
      kind === "vehicle_loss" ||
      kind === "vehicle_loss_driver"
    ) {
      if (nickKey(e.victim) === want) deaths.push(e);
      continue;
    }
    if (kind === "vehicle_kill") {
      if (nickKey(e.killer) === want) kills.push(e);
      continue;
    }
    if (kind === "driver_share") {
      // reason=nok → столбик ноков. die/vehicle_kill — не кил, столбик техники.
      if (nickKey(e.killer) === want) {
        if (e.reason === "nok") noks.push(e);
        else kills.push(e);
      }
      continue;
    }
    if (kind === "nok") {
      if (nickKey(e.killer) === want) noks.push(e);
      if (nickKey(e.victim) === want) gotNoks.push(e);
      continue;
    }
    if (nickKey(e.killer) === want) kills.push(e);
    if (nickKey(e.victim) === want) deaths.push(e);
  }
  const netFromMap = match.netByNick
    ? Object.entries(match.netByNick).find(([n]) => nickKey(n) === want)?.[1]
    : null;
  const net =
    netFromMap != null
      ? Number(netFromMap) || 0
      : kills.reduce((s, e) => s + e.delta, 0) +
        noks.reduce((s, e) => s + e.delta, 0) +
        revives.reduce((s, e) => s + e.delta, 0) -
        deaths.reduce((s, e) => s + Math.abs(e.delta), 0) -
        teamkills.reduce((s, e) => s + Math.abs(e.delta), 0);

  if (
    !kills.length &&
    !deaths.length &&
    !revives.length &&
    !teamkills.length &&
    !noks.length &&
    !gotNoks.length &&
    net === 0
  )
    return null;

  return {
    id: match.id,
    map: String(match.map || match.id),
    date: String(match.date || ""),
    net,
    kills,
    deaths,
    teamkills,
    revives,
    noks,
    gotNoks,
  };
}
