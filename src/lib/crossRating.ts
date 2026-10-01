/**
 * Межклановый рейтинг: Elo команд (калибровка) + PWR только врагов.
 * Канон: .cursor/rules/clan-cross-rating.mdc
 */

const KV_BASES = [
  process.env.KV_DATA_BASE,
  "https://keechbb.github.io/blackberry-kv",
  "https://kv.bb-squad.ru",
].filter(Boolean) as string[];

export const BB_MAIN_KEY = "BB-MAIN";
export const BB_JUNIOR_KEY = "BB-JUNIOR";
/** @deprecated use BB_MAIN_KEY / BB_JUNIOR_KEY */
export const BB_CLAN_KEY = BB_MAIN_KEY;

export const BB_STACKS = {
  [BB_MAIN_KEY]: {
    key: BB_MAIN_KEY,
    tag: "BB",
    name: "BlackBerry Main",
    stackMatch: (s: string) => {
      const t = s.trim().toLowerCase();
      return t === "main" || t === "мейн" || t === "";
    },
  },
  [BB_JUNIOR_KEY]: {
    key: BB_JUNIOR_KEY,
    tag: "BB JUNIOR",
    name: "BlackBerry Junior",
    stackMatch: (s: string) => {
      const t = s.trim().toLowerCase();
      return t === "junior" || t === "jr" || t.includes("junior");
    },
  },
} as const;

export function bbStackKeyFromMeeting(stack: string): string {
  if (BB_STACKS[BB_JUNIOR_KEY].stackMatch(stack)) return BB_JUNIOR_KEY;
  return BB_MAIN_KEY;
}

const ELO_START = 1000;
const ELO_K = 25;

/** Map opp label from calendar → stable key + display */
const OPP_CANON: Record<string, { key: string; tag: string; name: string }> = {
  "20royals": { key: "20R", tag: "20R", name: "20Royals" },
  "20r": { key: "20R", tag: "20R", name: "20Royals" },
  avg: { key: "AVG", tag: "AVG", name: "AVANGUARD" },
  avanguard: { key: "AVG", tag: "AVG", name: "AVANGUARD" },
  dcai: { key: "DCAI", tag: "DCAI", name: "De Caelo Ad Inferos" },
  hell: { key: "HELL", tag: "HELL", name: "HELL" },
  two: { key: "TWO", tag: "TWO", name: "Tactical Worm Co." },
  "44th": { key: "44th", tag: "44th", name: "44th Comp Team" },
  ih: { key: "IH", tag: "IH", name: "Iron Horde" },
  gm: { key: "GM", tag: "GM", name: "Grand Masters" },
  hq: { key: "HQ", tag: "HQ", name: "HQ" },
  h1gh: { key: "H1GH", tag: "H1GH", name: "H1gh" },
  h1g: { key: "H1GH", tag: "H1GH", name: "H1gh" },
  alpha: { key: "ALPHA", tag: "ALPHA", name: "ALPHA" },
  sph: { key: "SPH", tag: "SPH", name: "SPH" },
  fury: { key: "FURY", tag: "FURY", name: "Fury" },
  imp: { key: "IMP", tag: "IMP", name: "IMP" },
  cut: { key: "CUT", tag: "CUT", name: "CUT" },
  omen: { key: "OMEN", tag: "OMEN", name: "Team Omen" },
};

export type StatLine = {
  nick: string;
  res: number;
  nok: number;
  kills: number;
  deaths: number;
  dmg: number;
};

export type ClanEloRow = {
  key: string;
  tag: string;
  name: string;
  isBb: boolean;
  /** null = калибровка (цифры нет) */
  elo: number | null;
  /** скрытый elo всегда есть */
  eloHidden: number;
  calibrated: boolean;
  meetings: number;
  wins: number;
  losses: number;
  place: number;
  logoUrl: string | null;
};

export type ClanEloBoard = {
  rows: ClanEloRow[];
  bbEloMain: number;
  bbEloJunior: number;
  meetings: number;
  updatedAt: string;
};

export type EnemyPwrRow = {
  nick: string;
  clanKey: string;
  clanTag: string;
  games: number;
  wins: number;
  winPct: number | null;
  res: number;
  nok: number;
  kills: number;
  deaths: number;
  dmg: number;
  kd: number;
  pwr: number;
  rankLabel: string;
  rankKey: string;
  place: number;
  mvpMedic: number;
  mvpKiller: number;
  mvpDamage: number;
  antiDeath: number;
};

export type EnemyPwrBoard = {
  rows: EnemyPwrRow[];
  players: number;
  matchesWithOpp: number;
  updatedAt: string;
};

export type MeetingListItem = {
  matchId: string;
  month: string;
  day: number;
  timeMsk: string;
  opp: string;
  oppKey: string;
  oppTag: string;
  map: string;
  size: string;
  stack: string;
  status: string;
  meeting: string;
  r1: string;
  r2: string;
  playersUrl: string;
  bbWon: boolean;
};

export type MeetingDetail = MeetingListItem & {
  note?: string;
  usR1: StatLine[];
  usR2: StatLine[];
  oppR1: StatLine[];
  oppR2: StatLine[];
};

export type EnemyPlayerProfile = {
  nick: string;
  clanKey: string;
  clanTag: string;
  pwr: number;
  rankLabel: string;
  rankKey: string;
  games: number;
  wins: number;
  losses: number;
  res: number;
  nok: number;
  kills: number;
  deaths: number;
  dmg: number;
  kd: number;
  avgKills: number;
  avgDmg: number;
  history: {
    matchId: string;
    day: number;
    month: string;
    opp: string;
    map: string;
    stack: string;
    meeting: string;
    bbWon: boolean;
    res: number;
    nok: number;
    kills: number;
    deaths: number;
    dmg: number;
  }[];
};

type MonthMatch = {
  id?: string;
  day?: number;
  timeMsk?: string;
  opp?: string;
  map?: string;
  size?: string;
  stack?: string;
  status?: string;
  meeting?: string;
  r1?: string;
  r2?: string;
  note?: string;
  playersUrl?: string;
};

type PlayersFile = {
  matchId?: string;
  opp?: string;
  note?: string;
  r1?: Record<string, unknown>[];
  r2?: Record<string, unknown>[];
  total?: Record<string, unknown>[];
  players?: Record<string, unknown>[];
  oppR1?: Record<string, unknown>[];
  oppR2?: Record<string, unknown>[];
};

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

async function fetchJson(url: string) {
  const res = await fetch(url, { next: { revalidate: 60 } });
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

function softSat(x: number, mid: number) {
  const v = Math.max(0, x);
  const m = mid || 1;
  return v / (v + m);
}

function calcEnemyPwr(row: {
  games: number;
  wins: number;
  res: number;
  nok: number;
  kills: number;
  deaths: number;
  dmg: number;
}) {
  const g = Math.max(1, row.games);
  const r = row.res / g;
  const n = row.nok / g;
  const k = row.kills / g;
  const d = row.deaths / g;
  const c = row.dmg / g;
  const w = row.games > 0 ? Math.min(1, Math.max(0, row.wins / row.games)) : 0;
  const kd = row.deaths === 0 ? row.kills : row.kills / Math.max(row.deaths, 1);

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
  const kdMult = kd < 1 ? PWR.kdLowMult : 1;
  // tier 4 for enemies (no BB tier sheet)
  const tierMult = 1.1;

  let pwr = Math.round(Impact * Conf * 1000 * tierMult * kdMult);
  if (pwr < 0) pwr = 0;
  if (pwr > 1000) pwr = 1000;

  let label = PWR.bands[0][1];
  let rankKey = PWR.bands[0][2];
  for (let i = PWR.bands.length - 1; i >= 0; i--) {
    if (pwr >= PWR.bands[i][0]) {
      label = PWR.bands[i][1];
      rankKey = PWR.bands[i][2];
      break;
    }
  }
  return { pwr, label, rankKey, kd: Math.round(kd * 100) / 100 };
}

export function canonOpp(oppRaw: string) {
  const raw = String(oppRaw || "").trim();
  const k = raw.toLowerCase().replace(/\s+/g, "");
  if (OPP_CANON[k]) return OPP_CANON[k];
  const tag = raw || "?";
  return { key: tag.toUpperCase(), tag, name: tag };
}

const LOGO_EXT: Record<string, string> = {
  "BB-MAIN": ".png",
  "BB-JUNIOR": ".png",
  "20R": ".png",
  AVG: ".png",
  DCAI: ".jpg",
  HELL: ".jpg",
  TWO: ".jpg",
  "44th": ".jpg",
  IH: ".jpg",
  GM: ".jpg",
  HQ: ".png",
  H1GH: ".jpg",
  ALPHA: ".png",
  SPH: ".png",
  FURY: ".png",
  IMP: ".png",
  CUT: ".png",
  OMEN: ".png",
};

export function clanLogoUrl(key: string): string | null {
  const ext = LOGO_EXT[key];
  if (!ext) return null;
  return `/rating-logos/${key}${ext}`;
}

function parseTickets(side: string | undefined): { us: number; them: number } {
  const s = String(side || "").trim();
  const m = s.match(/^(\d+)\s*[:：]\s*(\d+)$/);
  if (!m) return { us: 0, them: 0 };
  return { us: Number(m[1]) || 0, them: Number(m[2]) || 0 };
}

/** Победа встречи по сумме тикетов; fallback на status. */
export function meetingBbWon(m: {
  r1?: string;
  r2?: string;
  status?: string;
}): boolean | null {
  const a = parseTickets(m.r1);
  const b = parseTickets(m.r2);
  const us = a.us + b.us;
  const them = a.them + b.them;
  if (us + them > 0) return us > them;
  const st = String(m.status || "").toLowerCase();
  if (st === "win") return true;
  if (st === "lose") return false;
  return null;
}

function expectedScore(eloA: number, eloB: number) {
  return 1 / (1 + Math.pow(10, (eloB - eloA) / 400));
}

function lineFromRaw(p: Record<string, unknown> | undefined): StatLine | null {
  const nick = String(p?.nick || "").trim();
  if (!nick) return null;
  return {
    nick,
    res: Number(p?.res) || 0,
    nok: Number(p?.nok) || 0,
    kills: Number(p?.kills) || 0,
    deaths: Number(p?.deaths) || 0,
    dmg: Number(p?.dmg) || 0,
  };
}

function linesFrom(arr: Record<string, unknown>[] | undefined): StatLine[] {
  const out: StatLine[] = [];
  for (const p of arr || []) {
    const row = lineFromRaw(p);
    if (row) out.push(row);
  }
  return out;
}

/** Exact nick match only — no fuzzy. */
export function nicksEqual(a: string, b: string) {
  return a.trim() === b.trim();
}

async function loadPlayedMeetings(): Promise<
  (MeetingListItem & { monthId: string; year: number; monthNum: number })[]
> {
  const index = await loadFromKv<{
    months?: { id?: string; year?: number; month?: number; url?: string }[];
  }>("data/index.json");
  if (!index?.months?.length) return [];

  // chronological: older months first
  const monthsMeta = [...index.months].sort((a, b) => {
    const ya = Number(a.year) || 0;
    const yb = Number(b.year) || 0;
    if (ya !== yb) return ya - yb;
    return (Number(a.month) || 0) - (Number(b.month) || 0);
  });

  const out: (MeetingListItem & {
    monthId: string;
    year: number;
    monthNum: number;
  })[] = [];

  for (const meta of monthsMeta) {
    if (!meta.url) continue;
    const month = await loadFromKv<{ matches?: MonthMatch[] }>(meta.url);
    const monthId = meta.id || `${meta.year}-${meta.month}`;
    const year = Number(meta.year) || 0;
    const monthNum = Number(meta.month) || 0;
    const matches = [...(month?.matches || [])].sort(
      (a, b) => (Number(a.day) || 0) - (Number(b.day) || 0)
    );
    for (const m of matches) {
      const st = String(m.status || "").toLowerCase();
      if (st === "upcoming" || st === "cancel" || st === "cancelled") continue;
      if (!m.id || !m.opp) continue;
      const won = meetingBbWon(m);
      if (won == null) continue;
      const opp = canonOpp(String(m.opp));
      out.push({
        matchId: String(m.id),
        month: monthId,
        monthId,
        year,
        monthNum,
        day: Number(m.day) || 0,
        timeMsk: String(m.timeMsk || ""),
        opp: String(m.opp),
        oppKey: opp.key,
        oppTag: opp.tag,
        map: String(m.map || ""),
        size: String(m.size || ""),
        stack: String(m.stack || ""),
        status: st,
        meeting: String(m.meeting || ""),
        r1: String(m.r1 || ""),
        r2: String(m.r2 || ""),
        playersUrl: String(m.playersUrl || ""),
        bbWon: won,
      });
    }
  }
  return out;
}

export async function buildClanEloBoard(): Promise<ClanEloBoard> {
  const meetings = await loadPlayedMeetings();
  const elo = new Map<string, number>();
  elo.set(BB_MAIN_KEY, ELO_START);
  elo.set(BB_JUNIOR_KEY, ELO_START);

  type Acc = {
    key: string;
    tag: string;
    name: string;
    meetings: number;
    winsVsBb: number;
    lossesVsBb: number;
    bbBeatenOnce: boolean;
  };
  const opps = new Map<string, Acc>();

  type BbAcc = { meetings: number; wins: number; losses: number };
  const bbAcc: Record<string, BbAcc> = {
    [BB_MAIN_KEY]: { meetings: 0, wins: 0, losses: 0 },
    [BB_JUNIOR_KEY]: { meetings: 0, wins: 0, losses: 0 },
  };

  for (const m of meetings) {
    const c = canonOpp(m.opp);
    const bbKey = bbStackKeyFromMeeting(m.stack);
    if (!elo.has(c.key)) elo.set(c.key, ELO_START);
    if (!opps.has(c.key)) {
      opps.set(c.key, {
        key: c.key,
        tag: c.tag,
        name: c.name,
        meetings: 0,
        winsVsBb: 0,
        lossesVsBb: 0,
        bbBeatenOnce: false,
      });
    }
    const acc = opps.get(c.key)!;
    acc.meetings += 1;
    bbAcc[bbKey].meetings += 1;

    const bbElo = elo.get(bbKey)!;
    const oppElo = elo.get(c.key)!;
    const expBb = expectedScore(bbElo, oppElo);
    const scoreBb = m.bbWon ? 1 : 0;
    const scoreOpp = m.bbWon ? 0 : 1;

    elo.set(bbKey, Math.round(bbElo + ELO_K * (scoreBb - expBb)));
    elo.set(
      c.key,
      Math.round(oppElo + ELO_K * (scoreOpp - (1 - expBb)))
    );

    if (m.bbWon) {
      acc.lossesVsBb += 1;
      acc.bbBeatenOnce = true;
      bbAcc[bbKey].wins += 1;
    } else {
      acc.winsVsBb += 1;
      bbAcc[bbKey].losses += 1;
    }
  }

  const bbEloMain = elo.get(BB_MAIN_KEY) ?? ELO_START;
  const bbEloJunior = elo.get(BB_JUNIOR_KEY) ?? ELO_START;

  const uncalibrated: ClanEloRow[] = [];
  const ranked: ClanEloRow[] = [];

  for (const acc of opps.values()) {
    const hidden = elo.get(acc.key) ?? ELO_START;
    const calibratedFlag = acc.bbBeatenOnce;
    const row: ClanEloRow = {
      key: acc.key,
      tag: acc.tag,
      name: acc.name,
      isBb: false,
      elo: calibratedFlag ? hidden : null,
      eloHidden: hidden,
      calibrated: calibratedFlag,
      meetings: acc.meetings,
      wins: acc.winsVsBb,
      losses: acc.lossesVsBb,
      place: 0,
      logoUrl: clanLogoUrl(acc.key),
    };
    if (calibratedFlag) ranked.push(row);
    else uncalibrated.push(row);
  }

  for (const key of [BB_MAIN_KEY, BB_JUNIOR_KEY] as const) {
    const meta = BB_STACKS[key];
    const e = elo.get(key) ?? ELO_START;
    const a = bbAcc[key];
    ranked.push({
      key: meta.key,
      tag: meta.tag,
      name: meta.name,
      isBb: true,
      elo: e,
      eloHidden: e,
      calibrated: true,
      meetings: a.meetings,
      wins: a.wins,
      losses: a.losses,
      place: 0,
      logoUrl: clanLogoUrl(key),
    });
  }

  uncalibrated.sort(
    (a, b) =>
      b.eloHidden - a.eloHidden ||
      b.meetings - a.meetings ||
      a.tag.localeCompare(b.tag, "ru")
  );

  ranked.sort(
    (a, b) =>
      (b.elo ?? 0) - (a.elo ?? 0) ||
      b.meetings - a.meetings ||
      a.name.localeCompare(b.name, "ru")
  );

  // Uncalibrated above everyone (incl. both BB stacks); then Elo order
  const rows = [...uncalibrated, ...ranked];
  rows.forEach((r, i) => {
    r.place = i + 1;
  });

  return {
    rows,
    bbEloMain,
    bbEloJunior,
    meetings: meetings.length,
    updatedAt: new Date().toISOString(),
  };
}

export async function listMeetings(): Promise<MeetingListItem[]> {
  const all = await loadPlayedMeetings();
  // newest first for UI
  return [...all].reverse().map(
    ({ monthId: _m, year: _y, monthNum: _n, ...rest }) => rest
  );
}

/** История встреч с кланом (BB-MAIN / BB-JUNIOR — только свой стек). */
export async function listMeetingsForClan(
  clanKeyRaw: string
): Promise<{ clan: { key: string; tag: string; name: string }; meetings: MeetingListItem[] }> {
  const key = String(clanKeyRaw || "").trim().toUpperCase();
  const all = await listMeetings();
  if (key === BB_MAIN_KEY || key === "BB" || key === "MAIN") {
    const meta = BB_STACKS[BB_MAIN_KEY];
    return {
      clan: { key: meta.key, tag: meta.tag, name: meta.name },
      meetings: all.filter((m) => bbStackKeyFromMeeting(m.stack) === BB_MAIN_KEY),
    };
  }
  if (key === BB_JUNIOR_KEY || key === "JUNIOR" || key === "BB-JR") {
    const meta = BB_STACKS[BB_JUNIOR_KEY];
    return {
      clan: { key: meta.key, tag: meta.tag, name: meta.name },
      meetings: all.filter(
        (m) => bbStackKeyFromMeeting(m.stack) === BB_JUNIOR_KEY
      ),
    };
  }
  const filtered = all.filter((m) => m.oppKey.toUpperCase() === key);
  const sample = filtered[0];
  const c = sample
    ? { key: sample.oppKey, tag: sample.oppTag, name: canonOpp(sample.opp).name }
    : canonOpp(key);
  return { clan: c, meetings: filtered };
}

export async function getMeetingDetail(
  matchId: string
): Promise<MeetingDetail | null> {
  const id = String(matchId || "").trim();
  if (!id) return null;

  const index = await loadFromKv<{
    months?: { id?: string; url?: string }[];
  }>("data/index.json");
  if (!index?.months?.length) return null;

  for (const meta of index.months) {
    if (!meta.url) continue;
    const month = await loadFromKv<{ matches?: MonthMatch[] }>(meta.url);
    const m = (month?.matches || []).find((x) => String(x.id) === id);
    if (!m) continue;
    const won = meetingBbWon(m);
    if (won == null) continue;
    const opp = canonOpp(String(m.opp || ""));
    let players: PlayersFile | null = null;
    if (m.playersUrl) {
      players = await loadFromKv<PlayersFile>(m.playersUrl);
    }
    return {
      matchId: id,
      month: meta.id || "",
      day: Number(m.day) || 0,
      timeMsk: String(m.timeMsk || ""),
      opp: String(m.opp || ""),
      oppKey: opp.key,
      oppTag: opp.tag,
      map: String(m.map || ""),
      size: String(m.size || ""),
      stack: String(m.stack || ""),
      status: String(m.status || ""),
      meeting: String(m.meeting || ""),
      r1: String(m.r1 || ""),
      r2: String(m.r2 || ""),
      playersUrl: String(m.playersUrl || ""),
      bbWon: won,
      note: m.note ? String(m.note) : undefined,
      usR1: linesFrom(players?.r1),
      usR2: linesFrom(players?.r2),
      oppR1: linesFrom(players?.oppR1),
      oppR2: linesFrom(players?.oppR2),
    };
  }
  return null;
}

type EnemyAcc = {
  nick: string;
  clanKey: string;
  clanTag: string;
  games: number;
  wins: number;
  res: number;
  nok: number;
  kills: number;
  deaths: number;
  dmg: number;
};

function bumpEnemy(
  map: Map<string, EnemyAcc>,
  nick: string,
  clanKey: string,
  clanTag: string,
  line: StatLine,
  bbWon: boolean
) {
  // exact nick key — no normalize beyond trim (canon: ask Alex on doubt)
  const key = nick.trim();
  if (!key) return;
  let row = map.get(key);
  if (!row) {
    row = {
      nick: key,
      clanKey,
      clanTag,
      games: 0,
      wins: 0,
      res: 0,
      nok: 0,
      kills: 0,
      deaths: 0,
      dmg: 0,
    };
    map.set(key, row);
  }
  row.games += 1;
  // enemy "win" = BB lost the meeting
  if (!bbWon) row.wins += 1;
  row.res += line.res;
  row.nok += line.nok;
  row.kills += line.kills;
  row.deaths += line.deaths;
  row.dmg += line.dmg;
  if (clanKey && row.clanKey !== clanKey) {
    // keep first clan tag; multi-clan later if Alex asks
  }
}

export async function buildEnemyPwrBoard(): Promise<EnemyPwrBoard> {
  const meetings = await loadPlayedMeetings();
  const map = new Map<string, EnemyAcc>();
  let matchesWithOpp = 0;

  for (const m of meetings) {
    if (!m.playersUrl) continue;
    const players = await loadFromKv<PlayersFile>(m.playersUrl);
    if (!players) continue;
    const oppLines = [
      ...linesFrom(players.oppR1),
      ...linesFrom(players.oppR2),
    ];
    if (!oppLines.length) continue;
    matchesWithOpp += 1;
    // Sum per nick within meeting then one game bump
    const perNick = new Map<string, StatLine>();
    for (const line of oppLines) {
      const k = line.nick.trim();
      if (!perNick.has(k)) {
        perNick.set(k, { ...line, nick: k });
      } else {
        const cur = perNick.get(k)!;
        cur.res += line.res;
        cur.nok += line.nok;
        cur.kills += line.kills;
        cur.deaths += line.deaths;
        cur.dmg += line.dmg;
      }
    }
    for (const line of perNick.values()) {
      bumpEnemy(map, line.nick, m.oppKey, m.oppTag, line, m.bbWon);
    }
  }

  const rows: EnemyPwrRow[] = [];
  for (const acc of map.values()) {
    const { pwr, label, rankKey, kd } = calcEnemyPwr(acc);
    const winPct =
      acc.games > 0
        ? Math.round((1000 * acc.wins) / acc.games) / 10
        : null;
    rows.push({
      nick: acc.nick,
      clanKey: acc.clanKey,
      clanTag: acc.clanTag,
      games: acc.games,
      wins: acc.wins,
      winPct,
      res: acc.res,
      nok: acc.nok,
      kills: acc.kills,
      deaths: acc.deaths,
      dmg: acc.dmg,
      kd,
      pwr,
      rankLabel: label,
      rankKey,
      place: 0,
      mvpMedic: 0,
      mvpKiller: 0,
      mvpDamage: 0,
      antiDeath: 0,
    });
  }
  rows.sort(
    (a, b) =>
      b.pwr - a.pwr ||
      b.kills - a.kills ||
      a.nick.localeCompare(b.nick, "ru")
  );
  rows.forEach((r, i) => {
    r.place = i + 1;
  });

  return {
    rows,
    players: rows.length,
    matchesWithOpp,
    updatedAt: new Date().toISOString(),
  };
}

export async function getEnemyPlayer(
  nickRaw: string
): Promise<EnemyPlayerProfile | null> {
  const want = String(nickRaw || "").trim();
  if (!want) return null;

  const meetings = await loadPlayedMeetings();
  const history: EnemyPlayerProfile["history"] = [];
  let clanKey = "";
  let clanTag = "";
  let games = 0;
  let wins = 0;
  let res = 0;
  let nok = 0;
  let kills = 0;
  let deaths = 0;
  let dmg = 0;
  let displayNick = want;

  for (const m of meetings) {
    if (!m.playersUrl) continue;
    const players = await loadFromKv<PlayersFile>(m.playersUrl);
    if (!players) continue;
    const oppLines = [
      ...linesFrom(players.oppR1),
      ...linesFrom(players.oppR2),
    ].filter((l) => nicksEqual(l.nick, want));
    if (!oppLines.length) continue;

    displayNick = oppLines[0].nick;
    const sum = oppLines.reduce(
      (a, l) => ({
        nick: displayNick,
        res: a.res + l.res,
        nok: a.nok + l.nok,
        kills: a.kills + l.kills,
        deaths: a.deaths + l.deaths,
        dmg: a.dmg + l.dmg,
      }),
      { nick: displayNick, res: 0, nok: 0, kills: 0, deaths: 0, dmg: 0 }
    );
    games += 1;
    if (!m.bbWon) wins += 1;
    res += sum.res;
    nok += sum.nok;
    kills += sum.kills;
    deaths += sum.deaths;
    dmg += sum.dmg;
    clanKey = m.oppKey;
    clanTag = m.oppTag;
    history.push({
      matchId: m.matchId,
      day: m.day,
      month: m.month,
      opp: m.opp,
      map: m.map,
      stack: m.stack,
      meeting: m.meeting,
      bbWon: m.bbWon,
      res: sum.res,
      nok: sum.nok,
      kills: sum.kills,
      deaths: sum.deaths,
      dmg: sum.dmg,
    });
  }

  if (!games) return null;

  const { pwr, label, rankKey, kd } = calcEnemyPwr({
    games,
    wins,
    res,
    nok,
    kills,
    deaths,
    dmg,
  });

  return {
    nick: displayNick,
    clanKey,
    clanTag,
    pwr,
    rankLabel: label,
    rankKey,
    games,
    wins,
    losses: games - wins,
    res,
    nok,
    kills,
    deaths,
    dmg,
    kd,
    avgKills: Math.round((10 * kills) / games) / 10,
    avgDmg: Math.round(dmg / games),
    history: history.reverse(),
  };
}
