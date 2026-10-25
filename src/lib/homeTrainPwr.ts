import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { loadTierIndex } from "@/lib/loadTierIndex";
import { pickMvps } from "@/lib/homeMvp";
import { abbreviateFaction } from "@/lib/factionAbbrev";
import { kvLocalRoots } from "@/lib/kvLocal";
import { memoTtl, PROFILE_CORPUS_TTL_MS } from "@/lib/memoTtl";

function nickKey(nick: string) {
  return nick.trim().toLowerCase().replace(/\s+/g, "");
}

/** «Russian Ground Forces» ↔ «RGF» ↔ winner из month JSON. */
function factionEq(a: string, b: string): boolean {
  const A = String(a || "").trim().toUpperCase();
  const B = String(b || "").trim().toUpperCase();
  if (!A || !B || A === "—" || B === "—") return false;
  if (A === B) return true;
  return (
    abbreviateFaction(a).toUpperCase() === abbreviateFaction(b).toUpperCase()
  );
}

type TrainPlayerLine = {
  nick?: string;
  res?: number;
  nok?: number;
  kills?: number;
  deaths?: number;
  dmg?: number;
  team?: string;
  won?: boolean;
};

type TrainPlayersDoc = {
  players?: TrainPlayerLine[];
  teamA?: TrainPlayerLine[];
  teamB?: TrainPlayerLine[];
  winner?: string;
  sideA?: { name?: string; tickets?: number };
  sideB?: { name?: string; tickets?: number };
};

type TrainMatchSideMeta = {
  winner?: string;
  factionA?: string;
  factionB?: string;
  ticketsA?: number | null;
  ticketsB?: number | null;
};

/** Победа/поражение по won/team, teamA/teamB или тикетам сторон. */
function resolveTrainWon(
  mine: TrainPlayerLine[],
  players: TrainPlayersDoc,
  match?: TrainMatchSideMeta | string
): { team: string; won: boolean | null } {
  const meta: TrainMatchSideMeta =
    typeof match === "string" ? { winner: match } : match || {};
  const winner = String(
    meta.winner || players.winner || ""
  ).trim();

  // Явный boolean (в т.ч. false) — главный источник
  if (mine.some((p) => p.won === true)) {
    const t = mine.find((p) => p.team)?.team || mine[0]?.team || "";
    return { team: String(t).toUpperCase() || "—", won: true };
  }
  if (mine.some((p) => p.won === false)) {
    const t = mine.find((p) => p.team)?.team || mine[0]?.team || "";
    return { team: String(t).toUpperCase() || "—", won: false };
  }

  const wantNicks = new Set(
    mine.map((p) => nickKey(String(p.nick || ""))).filter(Boolean)
  );
  const inList = (rows: TrainPlayerLine[] | undefined) =>
    (rows || []).some((p) => wantNicks.has(nickKey(String(p.nick || ""))));

  const sideA = String(
    players.sideA?.name || meta.factionA || ""
  ).trim();
  const sideB = String(
    players.sideB?.name || meta.factionB || ""
  ).trim();

  let team = "";
  for (const p of mine) {
    if (!team && p.team) team = String(p.team);
  }

  let onA = inList(players.teamA);
  let onB = inList(players.teamB);
  // если players[] без teamA/B — по полю team
  if (!onA && !onB && team) {
    onA = factionEq(team, sideA);
    onB = factionEq(team, sideB);
  }
  if (!team) {
    if (onA) team = sideA || "A";
    else if (onB) team = sideB || "B";
  }

  const teamU = team.toUpperCase();
  if (winner && (onA || onB || teamU)) {
    if (factionEq(team || (onA ? sideA : sideB), winner)) {
      return { team: teamU || (onA ? sideA : sideB).toUpperCase(), won: true };
    }
    if (onA || onB || teamU) {
      return { team: teamU || (onA ? sideA : sideB).toUpperCase(), won: false };
    }
  }

  const ta = Number(
    players.sideA?.tickets ?? meta.ticketsA
  );
  const tb = Number(
    players.sideB?.tickets ?? meta.ticketsB
  );
  if (
    (onA || onB) &&
    Number.isFinite(ta) &&
    Number.isFinite(tb) &&
    (ta > 0 || tb > 0) &&
    ta !== tb
  ) {
    const myTickets = onA ? ta : tb;
    const oppTickets = onA ? tb : ta;
    return {
      team: teamU || (onA ? sideA : sideB).toUpperCase() || "—",
      won: myTickets > oppTickets,
    };
  }
  return { team: teamU || "—", won: null };
}

export type HomeTrainPwrRow = {
  nick: string;
  /** Respect Points (видимый рейтинг тренировок). */
  rp: number;
  /** @deprecated alias of rp — старые импорты */
  pwr: number;
  rankLabel: string;
  rankKey: string;
  games: number;
  place: number;
  predatorPlace?: number | null;
  nickPatch?: string | null;
  nickStyle?: string | null;
  matches?: import("@/lib/trainRp").RpPlayerMatch[];
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

async function loadFromKv<T>(path: string): Promise<T | null> {
  const { loadKvJsonCached } = await import("@/lib/kvLocal");
  return loadKvJsonCached<T>(path.replace(/^\//, ""));
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
        matches?: {
          playersUrl?: string;
          winner?: string;
          factionA?: string;
          factionB?: string;
          ticketsA?: number | null;
          ticketsB?: number | null;
        }[];
      }>(m.url);
    })
  );

  const matchList: (TrainMatchSideMeta & { playersUrl: string })[] = [];
  for (const month of months) {
    if (!month?.matches) continue;
    for (const match of month.matches) {
      if (!match.playersUrl) continue;
      matchList.push({
        playersUrl: match.playersUrl,
        winner: match.winner,
        factionA: match.factionA,
        factionB: match.factionB,
        ticketsA: match.ticketsA,
        ticketsB: match.ticketsB,
      });
    }
  }

  const bundles = await Promise.all(
    matchList.map(async (m) => {
      const players = await loadFromKv<TrainPlayersDoc>(m.playersUrl);
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
    ) as TrainPlayerLine[];

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
      const { won } = resolveTrainWon([p], players, match);
      if (won === true) row.wins += 1;
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
      rp: pwr,
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
  const { buildTrainRpLeaderboard } = await import("@/lib/trainRp");
  const { loadNickPatchByNick } = await import("@/lib/nickPatchesCache");
  const [board, cosmetics] = await Promise.all([
    buildTrainRpLeaderboard(),
    loadNickPatchByNick().catch(() => new Map()),
  ]);
  const rows: HomeTrainPwrRow[] = board.rows.map((r) => {
    const rp = Math.round(Number(r.rp) || 0);
    const cos = cosmetics.get(String(r.nick || "").trim().toLowerCase());
    return {
      nick: r.nick,
      rp,
      pwr: rp,
      rankLabel: r.rankLabel,
      rankKey: r.rankKey,
      games: r.games,
      place: r.place,
      predatorPlace: r.predatorPlace ?? null,
      nickPatch: cos?.patchId || null,
      nickStyle: cos?.styleId || null,
    };
  });
  return {
    top10: rows.slice(0, 10),
    players: board.players,
    matches: board.matches,
    updatedAt: board.updatedAt,
  };
}

/** Профиль: RP / Rank / место + разбор по картам. */
export async function lookupPlayerTrainPwr(
  nick: string
): Promise<HomeTrainPwrRow | null> {
  const clean = String(nick || "").trim();
  if (!clean) return null;
  const { loadRpLadder } = await import("@/lib/trainRp");
  // slim ladder only (~0.2MB) — drilldown loads full ledger via /api/train/rp-player
  const ladder = await loadRpLadder();
  if (!ladder?.players) return null;
  const key = nickKey(clean);
  const player =
    ladder.players[key] ||
    Object.values(ladder.players).find((p) => nickKey(p.nick) === key) ||
    null;
  if (!player) return null;
  const place =
    (ladder.leaderboard || []).findIndex(
      (r) => nickKey(r.nick) === nickKey(player.nick)
    ) + 1 || null;
  const rp = Math.round(Number(player.rp) || 0);
  const rankLabel = player.predatorPlace
    ? `PREDATOR #${player.predatorPlace}`
    : player.rankLabel;
  return {
    nick: player.nick,
    rp,
    pwr: rp,
    rankLabel,
    rankKey: player.rankKey,
    games: player.matches?.length || 0,
    place: place || (ladder.leaderboard?.length || 0) + 1,
    predatorPlace: player.predatorPlace ?? null,
    matches: await (
      await import("@/lib/trainRp")
    ).withTrainMatchTimes(
      (player.matches || []).map((m) => ({
        id: m.id,
        map: m.map,
        date: m.date,
        net: m.net,
        kills: [],
        deaths: [],
        teamkills: [],
        revives: [],
      }))
    ),
  };
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
  winner?: string;
  duration?: string;
  server?: string;
  playersUrl: string;
  won: boolean | null;
  /** Итоговое RP после матча; null если матч ещё без RP-ledger */
  rpAfter: number | null;
  /** Δ RP за матч; null если нет ledger */
  rpDelta: number | null;
  /** @deprecated aliases */
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
  duration?: string;
  server?: string;
  playersUrl: string;
  sortKey: string;
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

type TrainCorpusDoc = TrainPlayersDoc & {
  mvp?: {
    train?: {
      medic?: string[];
      killer?: string[];
      damage?: string[];
      antiDeath?: string[];
    };
  };
};

type TrainCorpusRow = MatchMeta & {
  status?: string;
  inHistory: boolean;
  doc: TrainCorpusDoc | null;
};

type TrainPlayerCorpus = {
  hasIndex: boolean;
  aliases: Record<string, string>;
  rows: TrainCorpusRow[];
};

/** Все катки тренировок с файлами игроков — один проход на две минуты. */
async function loadTrainPlayerCorpus(): Promise<TrainPlayerCorpus> {
  const index = await loadFromKv<{
    months?: { year?: number; month?: number; url?: string }[];
  }>("data/training-index.json");
  const tiersRaw = await loadFromKv<{
    aliases?: Record<string, string>;
  }>("data/tiers.json");
  const aliases = tiersRaw?.aliases || {};
  if (!index?.months?.length) return { hasIndex: false, aliases, rows: [] };

  const pending: Omit<TrainCorpusRow, "doc">[] = [];
  for (const m of index.months) {
    if (!m.url) continue;
    const year = m.year ?? 0;
    const month = m.month ?? 0;
    const monthOk = m.year != null && m.month != null;
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
        duration?: string;
        server?: string;
        status?: string;
        playersUrl?: string;
      }[];
    }>(m.url);
    (monthData?.matches || []).forEach((match, ord) => {
      // Без playersUrl катка всё равно нужна в календаре: иначе её ΔRP
      // уезжает в конец суммы и колонка RP прыгает (бейдж при этом верный).
      if (!match.id) return;
      const time = String(match.timeMsk || "").trim();
      let timeKey = /^\d{1,2}:\d{2}/.test(time)
        ? time.padStart(5, "0")
        : `99:${pad2(ord)}`;
      const hm = /^(\d{1,2}):(\d{2})/.exec(timeKey);
      if (hm) {
        const h = Number(hm[1]);
        const mi = Number(hm[2]);
        if (h === 0 && mi <= 29) timeKey = `24:${pad2(mi)}`;
      }
      const day = match.day ?? 0;
      const inHistory = monthOk && Boolean(match.id) && match.day != null;
      pending.push({
        id: String(match.id || ""),
        day,
        inHistory,
        year,
        month,
        timeMsk: match.timeMsk,
        map: match.map,
        factionA: match.factionA,
        ticketsA: match.ticketsA ?? null,
        factionB: match.factionB,
        ticketsB: match.ticketsB ?? null,
        winner: match.winner,
        duration: match.duration,
        server: match.server,
        status: match.status,
        playersUrl: match.playersUrl || "",
        sortKey: inHistory
          ? `${year}-${pad2(month)}-${pad2(match.day!)}T${timeKey}-${pad2(ord)}`
          : "",
      });
    });
  }

  const CONCURRENCY = 12;
  const rows: TrainCorpusRow[] = new Array(pending.length);
  for (let i = 0; i < pending.length; i += CONCURRENCY) {
    const slice = pending.slice(i, i + CONCURRENCY);
    const loaded = await Promise.all(
      slice.map((row) =>
        row.playersUrl
          ? loadFromKv<TrainCorpusDoc>(row.playersUrl).catch(() => null)
          : Promise.resolve(null)
      )
    );
    for (let j = 0; j < slice.length; j++) {
      rows[i + j] = { ...slice[j], doc: loaded[j] };
    }
  }
  return { hasIndex: true, aliases, rows };
}

/** mtime календаря и лестницы. Ключ мемо меняется сразу после записи файла. */
function trainCorpusStamp(): string {
  const bits: string[] = [];
  for (const root of kvLocalRoots()) {
    const dir = path.join(root, "data", "training");
    try {
      const names = readdirSync(dir)
        .filter((n) => n === "rp-ladder.json" || /^\d{4}-\d{2}\.json$/.test(n))
        .sort();
      for (const name of names) {
        bits.push(
          `${name}:${Math.floor(statSync(path.join(dir, name)).mtimeMs)}`
        );
      }
      bits.push(
        `idx:${Math.floor(statSync(path.join(root, "data", "training-index.json")).mtimeMs)}`
      );
      if (bits.length) return bits.join("|");
    } catch {
      /* следующий корень */
    }
  }
  return "0";
}

function getTrainPlayerCorpus(): Promise<TrainPlayerCorpus> {
  return memoTtl(
    `train-player-corpus-v2:${trainCorpusStamp()}`,
    PROFILE_CORPUS_TTL_MS,
    loadTrainPlayerCorpus
  );
}

function aliasResolver(aliases: Record<string, string>) {
  const aliasCanon = new Map<string, string>();
  for (const [a, c] of Object.entries(aliases)) {
    aliasCanon.set(nickKey(a), String(c));
  }
  return (n: string) => {
    const key = nickKey(n);
    const canon = aliasCanon.get(key);
    return canon ? nickKey(canon) : key;
  };
}

/** История тренировок игрока с ΔRP после каждой катки (хронология). */
export async function buildPlayerTrainMatchHistory(
  nick: string
): Promise<TrainMatchHistoryRow[]> {
  const clean = String(nick || "").trim();
  if (!clean) return [];

  const corpus = await getTrainPlayerCorpus();
  if (!corpus.hasIndex) return [];
  const resolveKey = aliasResolver(corpus.aliases);
  const want = resolveKey(clean);

  const matchMetas = corpus.rows.filter((row) => row.inHistory);
  matchMetas.sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  const { loadRpLadder, rpRankFromScore, lookupPlayerTrainRp } = await import(
    "@/lib/trainRp"
  );
  const ladder = await loadRpLadder();
  const rpPlayer = await lookupPlayerTrainRp(clean);
  const rpNetByMatch = new Map<string, number>();
  // Канон — matches из карточки игрока в ladder (уже с алиасами), как у бейджа.
  for (const m of rpPlayer?.matches || []) {
    rpNetByMatch.set(m.id, Number(m.net) || 0);
  }
  // fallback: netByNick по матчам ladder; суммируем все варианты ника (алиасы).
  if (ladder?.matches) {
    for (const m of ladder.matches) {
      if (rpNetByMatch.has(m.id)) continue;
      let sum = 0;
      let hit = false;
      for (const [n, net] of Object.entries(m.netByNick || {})) {
        if (resolveKey(n) === want) {
          sum += Number(net) || 0;
          hit = true;
        }
      }
      if (hit) rpNetByMatch.set(m.id, sum);
    }
  }
  const startRp = Number(ladder?.startRp) || 1000;
  const step = Number(ladder?.step) || 150;
  const radiant3Max = Number(ladder?.radiant3Max) || 4950;

  // Полная цепочка ladder (все катки с ΔRP игрока), даже если players/*.json нет.
  // rpAfter = round(start + Σ nets) как бейдж — не Math.round на каждом шаге (дрейф ±2).
  // Порядок = календарное время (sortKey), НЕ date+id: иначе 16-cslmutaha
  // оказывается «раньше» Fallujah/Kamdesh и колонка RP прыгает между соседними строками.
  const rpAfterByMatch = new Map<string, number>();
  const rpDeltaByMatch = new Map<string, number>();
  {
    const metaOrder = new Map(
      matchMetas.filter((m) => m.id).map((m) => [m.id, m.sortKey || ""])
    );
    const dateById = new Map<string, string>();
    for (const m of rpPlayer?.matches || []) {
      dateById.set(m.id, String(m.date || ""));
    }
    for (const m of ladder?.matches || []) {
      if (!dateById.has(m.id)) dateById.set(m.id, String(m.date || ""));
    }
    // Нет sortKey — всё равно дата катки, а не «в конец списка».
    // Иначе катки без файла состава суммируются после сегодняшних,
    // и на свежей строке оказывается чужой промежуточный RP.
    const orderKey = (id: string) => {
      const sk = metaOrder.get(id);
      if (sk) return sk;
      const d = dateById.get(id) || "9999-99-99";
      return `${d}T99:99-${id}`;
    };
    const orderedIds = [...rpNetByMatch.keys()].sort((a, b) => {
      const c = orderKey(a).localeCompare(orderKey(b));
      return c || a.localeCompare(b);
    });
    let cum = 0;
    for (const id of orderedIds) {
      const net = rpNetByMatch.get(id)!;
      cum += net;
      rpDeltaByMatch.set(id, Math.round(net));
      rpAfterByMatch.set(id, Math.round(startRp + cum));
    }
  }

  const history: TrainMatchHistoryRow[] = [];
  const seenIds = new Set<string>();
  const metaById = new Map(matchMetas.map((m) => [m.id, m]));

  const pushRpRow = (opts: {
    matchId: string;
    dateLabel: string;
    timeLabel: string;
    map: string;
    factionA: string;
    ticketsA: number | null;
    factionB: string;
    ticketsB: number | null;
    team: string;
    winner?: string;
    duration?: string;
    server?: string;
    playersUrl: string;
    won: boolean | null;
  }) => {
    let rpDelta: number | null = null;
    let rpAfter: number | null = null;
    let rankLabel = "—";
    let rankKey = "iron";
    if (rpAfterByMatch.has(opts.matchId)) {
      rpDelta = rpDeltaByMatch.get(opts.matchId)!;
      rpAfter = rpAfterByMatch.get(opts.matchId)!;
      const rk = rpRankFromScore(rpAfter, step, radiant3Max);
      rankLabel = rk.label;
      rankKey = rk.rankKey;
    } else if (rpNetByMatch.has(opts.matchId)) {
      rpDelta = Math.round(rpNetByMatch.get(opts.matchId)!);
    }
    history.push({
      ...opts,
      rpAfter,
      rpDelta,
      pwrAfter: rpAfter != null ? rpAfter : 0,
      pwrDelta: rpDelta != null ? rpDelta : 0,
      rankLabel,
      rankKey,
    });
    seenIds.add(opts.matchId);
  };

  for (const match of matchMetas) {
    const players = match.doc;
    let teamU = "—";
    let won: boolean | null = null;
    let ticketsA = match.ticketsA ?? null;
    let ticketsB = match.ticketsB ?? null;
    let factionA = String(match.factionA || "").trim();
    let factionB = String(match.factionB || "").trim();
    let winner = match.winner;

    if (players) {
      if (ticketsA == null && players.sideA?.tickets != null) {
        ticketsA = Number(players.sideA.tickets);
      }
      if (ticketsB == null && players.sideB?.tickets != null) {
        ticketsB = Number(players.sideB.tickets);
      }
      if (!factionA && players.sideA?.name) factionA = String(players.sideA.name);
      if (!factionB && players.sideB?.name) factionB = String(players.sideB.name);
      if (!winner && players.winner) winner = String(players.winner);
      const list = (
        players.players?.length
          ? players.players
          : [...(players.teamA || []), ...(players.teamB || [])]
      ) as TrainPlayerLine[];
      const mine = list.filter((p) => p?.nick && resolveKey(p.nick) === want);
      if (mine.length) {
        const resolved = resolveTrainWon(mine, players, {
          winner,
          factionA,
          factionB,
          ticketsA,
          ticketsB,
        });
        teamU = resolved.team || "—";
        won = resolved.won;
      } else if (!rpAfterByMatch.has(match.id)) {
        continue;
      }
    } else if (!rpAfterByMatch.has(match.id)) {
      continue;
    }

    const timeRaw = String(match.timeMsk || "").trim();
    pushRpRow({
      matchId: match.id,
      dateLabel: `${pad2(match.day)}.${pad2(match.month)}.${match.year}`,
      timeLabel: timeRaw && timeRaw !== "—" ? timeRaw : "—",
      map: match.map || "—",
      factionA: (factionA || "—").toUpperCase(),
      ticketsA,
      factionB: (factionB || "—").toUpperCase(),
      ticketsB,
      team: teamU,
      winner,
      duration: match.duration,
      server: match.server,
      playersUrl: match.playersUrl || "",
      won,
    });
  }

  // Катки только в ladder (нет в month index) — подтянуть счёт из players/*.json.
  // Иначе витрина профиля: ΔRP есть, а «-- : --» и результат «-».
  for (const m of rpPlayer?.matches || []) {
    if (seenIds.has(m.id) || !rpAfterByMatch.has(m.id)) continue;
    const meta = metaById.get(m.id);
    const playersUrl =
      meta?.playersUrl || `data/training/players/${m.id}.json`;
    const playersDoc =
      meta?.doc ||
      (await loadFromKv<TrainCorpusDoc>(playersUrl).catch(() => null));
    let teamU = "—";
    let won: boolean | null = null;
    let ticketsA = meta?.ticketsA ?? null;
    let ticketsB = meta?.ticketsB ?? null;
    let factionA = String(meta?.factionA || "").trim();
    let factionB = String(meta?.factionB || "").trim();
    let winner = meta?.winner;
    if (playersDoc) {
      const sa = playersDoc.sideA;
      const sb = playersDoc.sideB;
      if (ticketsA == null && sa?.tickets != null) ticketsA = Number(sa.tickets);
      if (ticketsB == null && sb?.tickets != null) ticketsB = Number(sb.tickets);
      if (!factionA && sa?.name) factionA = String(sa.name);
      if (!factionB && sb?.name) factionB = String(sb.name);
      if (!winner && playersDoc.winner) winner = String(playersDoc.winner);
      const list = (
        playersDoc.players?.length
          ? playersDoc.players
          : [...(playersDoc.teamA || []), ...(playersDoc.teamB || [])]
      ) as TrainPlayerLine[];
      const mine = list.filter((p) => p?.nick && resolveKey(p.nick) === want);
      if (mine.length) {
        const resolved = resolveTrainWon(mine, playersDoc, {
          winner,
          factionA,
          factionB,
          ticketsA,
          ticketsB,
        });
        teamU = resolved.team || "—";
        won = resolved.won;
      }
    }
    const date = String(m.date || "");
    const dateLabel = meta
      ? `${pad2(meta.day)}.${pad2(meta.month)}.${meta.year}`
      : date.length >= 10
        ? `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`
        : "—";
    const timeRaw = String(meta?.timeMsk || "").trim();
    pushRpRow({
      matchId: m.id,
      dateLabel,
      timeLabel: timeRaw && timeRaw !== "—" ? timeRaw : "—",
      map: meta?.map || m.map || "—",
      factionA: (factionA || "—").toUpperCase(),
      ticketsA,
      factionB: (factionB || "—").toUpperCase(),
      ticketsB,
      team: teamU,
      winner,
      duration: meta?.duration,
      server: meta?.server,
      playersUrl,
      won,
    });
  }

  // Один и тот же счёт без RP — копия уже засчитанной катки. Оставляем строку с ΔRP.
  const kept: TrainMatchHistoryRow[] = [];
  const bySig = new Map<string, TrainMatchHistoryRow[]>();
  for (const row of history) {
    const sig = [
      row.dateLabel,
      row.map,
      row.ticketsA ?? "",
      row.ticketsB ?? "",
      row.duration || "",
      row.factionA,
      row.factionB,
    ].join("|");
    const list = bySig.get(sig);
    if (list) list.push(row);
    else bySig.set(sig, [row]);
  }
  for (const list of bySig.values()) {
    const withRp = list.filter((row) => row.rpDelta != null);
    if (withRp.length) kept.push(...withRp);
    else {
      kept.push(
        list.find((row) => row.timeLabel && row.timeLabel !== "—") || list[0]
      );
    }
  }
  history.length = 0;
  history.push(...kept);

  return sortTrainHistoryNewestFirst(history, metaById);
}

/**
 * История ТМ / паблика: всегда свежие сверху.
 * Ключ только YYYY-MM-DD + время — никогда не мешать ISO sortKey с подписью DD.MM.YYYY
 * (иначе строки без календаря уезжают в чужой порядок).
 */
export function trainHistoryChronoKey(
  row: Pick<TrainMatchHistoryRow, "matchId" | "dateLabel" | "timeLabel">,
  metaSortKey?: string | null
): string {
  if (metaSortKey) return metaSortKey;
  const d = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(row.dateLabel || "").trim());
  const iso = d ? `${d[3]}-${d[2]}-${d[1]}` : "0000-00-00";
  let timeKey = "23:59";
  const hm = /^(\d{1,2}):(\d{2})/.exec(String(row.timeLabel || "").trim());
  if (hm) {
    let h = Number(hm[1]);
    const mi = Number(hm[2]);
    if (h === 0 && mi <= 29) h = 24;
    timeKey = `${String(h).padStart(2, "0")}:${pad2(mi)}`;
  }
  return `${iso}T${timeKey}-${row.matchId}`;
}

export function sortTrainHistoryNewestFirst(
  rows: TrainMatchHistoryRow[],
  metaById?: Map<string, { sortKey?: string }>
): TrainMatchHistoryRow[] {
  return [...rows].sort((a, b) => {
    const ka = trainHistoryChronoKey(a, metaById?.get(a.matchId)?.sortKey);
    const kb = trainHistoryChronoKey(b, metaById?.get(b.matchId)?.sortKey);
    return kb.localeCompare(ka);
  });
}

export type PlayerTrainCombatStats = {
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
  /** MVP War-Score (max dmg за катку) */
  mvpDamage: number;
  mvpKiller: number;
  mvpMedic: number;
  antiDeath: number;
  /** Рейтинг RP тренировок (клетка в профиле, как у паблика). */
  rp?: number | null;
  rankLabel?: string | null;
  rankKey?: string | null;
  predatorPlace?: number | null;
  /** Матчи с MVP Killer / Medic (для клика по клеткам) */
  mvpHits?: {
    killer: {
      id: string;
      dateLabel: string;
      title: string;
      sub?: string;
      playersUrl?: string | null;
    }[];
    medic: {
      id: string;
      dateLabel: string;
      title: string;
      sub?: string;
      playersUrl?: string | null;
    }[];
    armor: {
      id: string;
      dateLabel: string;
      title: string;
      sub?: string;
      playersUrl?: string | null;
    }[];
  };
};

/** Сводка боевой статы по тренировочным каткам (для вкладки профиля). */
export async function buildPlayerTrainCombatStats(
  nick: string
): Promise<PlayerTrainCombatStats | null> {
  const clean = String(nick || "").trim();
  if (!clean) return null;

  const emptyBase = {
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
    mvpHits: { killer: [], medic: [], armor: [] },
  };

  async function withTrainRp(
    base: typeof emptyBase & { nick: string }
  ): Promise<PlayerTrainCombatStats> {
    const trainRp = await lookupPlayerTrainPwr(base.nick).catch(() => null);
    return {
      ...base,
      rp: trainRp?.rp ?? null,
      rankLabel: trainRp?.rankLabel ?? null,
      rankKey: trainRp?.rankKey ?? null,
      predatorPlace: trainRp?.predatorPlace ?? null,
    };
  }

  const corpus = await getTrainPlayerCorpus();
  if (!corpus.hasIndex) return withTrainRp(emptyBase);
  const resolveKey = aliasResolver(corpus.aliases);
  const want = resolveKey(clean);

  let matches = 0;
  let wins = 0;
  let losses = 0;
  let kills = 0;
  let deaths = 0;
  let dmg = 0;
  let res = 0;
  let nok = 0;
  const mvpDamage = 0;
  let mvpKiller = 0;
  let mvpMedic = 0;
  let antiDeath = 0;
  let displayNick = clean;
  const mvpHits = {
    killer: [] as NonNullable<PlayerTrainCombatStats["mvpHits"]>["killer"],
    medic: [] as NonNullable<PlayerTrainCombatStats["mvpHits"]>["medic"],
    armor: [] as NonNullable<PlayerTrainCombatStats["mvpHits"]>["armor"],
  };

  const nickIn = (list: string[] | undefined) =>
    (list || []).some((n) => resolveKey(n) === want);

  for (const match of corpus.rows) {
    if (!match.playersUrl || match.status === "upcoming") continue;
    const players = match.doc;
    if (!players) continue;
    {
      const list = (
        players.players?.length
          ? players.players
          : [...(players.teamA || []), ...(players.teamB || [])]
      ) as TrainPlayerLine[];
      const mine = list.filter((p) => p?.nick && resolveKey(p.nick) === want);
      if (!mine.length) continue;
      if (mine[0]?.nick) displayNick = String(mine[0].nick);
      matches += 1;
      for (const p of mine) {
        kills += Number(p.kills) || 0;
        deaths += Number(p.deaths) || 0;
        dmg += Number(p.dmg) || 0;
        res += Number(p.res) || 0;
        nok += Number(p.nok) || 0;
      }
      const { won } = resolveTrainWon(mine, players, match);
      if (won === true) wins += 1;
      else if (won === false) losses += 1;

      const mvp =
        (players.mvp && players.mvp.train) ||
        pickMvps(
          list
            .filter((p) => p?.nick)
            .map((p) => ({
              nick: String(p.nick),
              res: Number(p.res) || 0,
              nok: Number(p.nok) || 0,
              kills: Number(p.kills) || 0,
              deaths: Number(p.deaths) || 0,
              dmg: Number(p.dmg) || 0,
            }))
        );
      const dateLabel = `${pad2(match.day)}.${pad2(match.month)}.${match.year}`;
      const hitBase = {
        dateLabel,
        title: match.map || "Тренировка",
        sub: match.timeMsk ? `${match.timeMsk} МСК` : undefined,
        playersUrl: match.playersUrl || null,
      };
      // War-Score на тренировках не считаем (боевой счёт недостоверен)
      if (nickIn(mvp.killer)) {
        mvpKiller += 1;
        mvpHits.killer.push({
          id: `${match.id}-killer`,
          ...hitBase,
        });
      }
      if (nickIn(mvp.medic)) {
        mvpMedic += 1;
        mvpHits.medic.push({
          id: `${match.id}-medic`,
          ...hitBase,
        });
      }
      if (nickIn(mvp.antiDeath)) antiDeath += 1;
    }
  }

  const kd =
    Math.round((deaths === 0 ? kills : kills / Math.max(deaths, 1)) * 100) /
    100;
  const avgKills =
    matches > 0 ? Math.round((10 * kills) / matches) / 10 : 0;
  const avgDmg = matches > 0 ? Math.round(dmg / matches) : 0;
  const decided = wins + losses;
  const winrate =
    decided > 0 ? Math.round((1000 * wins) / decided) / 10 : 0;

  return withTrainRp({
    nick: displayNick,
    matches,
    wins,
    losses,
    kills,
    deaths,
    dmg,
    res,
    nok,
    kd: deaths === 0 ? kills : kd,
    avgKills,
    avgDmg,
    winrate,
    mvpDamage,
    mvpKiller,
    mvpMedic,
    antiDeath,
    mvpHits,
  });
}
