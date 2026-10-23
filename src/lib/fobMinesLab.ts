/**
 * Lab: FOB damage + mine plant/detonate from SquadGame.log cache.
 * Server-only (fs). Keech learning panel.
 */
import fs from "node:fs";
import path from "node:path";

export type FobHit = {
  at: string;
  server: string;
  fobId: string;
  fobKind: string;
  damage: number;
  healthLeft: number;
  nick: string;
  steamId: string;
  causer: string;
  weapon: string;
};

export type FobSummary = {
  fobId: string;
  fobKind: string;
  server: string;
  hits: number;
  totalDamage: number;
  lastHealth: number | null;
  likelyDestroyed: boolean;
  topDamagers: Array<{ nick: string; steamId: string; damage: number; hits: number }>;
  lastHit: FobHit | null;
};

export type MinePlant = {
  at: string;
  server: string;
  mineId: string;
  mineKind: string;
  team: string;
  nick: string;
  steamId: string;
  loc: string;
};

export type MineDetonation = {
  at: string;
  server: string;
  mineId: string;
  mineKind: string;
  nick: string; // planter / attributed instigator
  steamId: string;
  target: string;
  damage: number;
  killed: boolean;
};

export type FobMinesLabBoard = {
  updatedAt: string;
  logRoot: string;
  filesScanned: string[];
  notes: string[];
  fob: {
    hits: FobHit[];
    summaries: FobSummary[];
    topDamagers: Array<{ nick: string; steamId: string; damage: number; hits: number }>;
  };
  mines: {
    plants: MinePlant[];
    detonations: MineDetonation[];
    byPlanter: Array<{
      nick: string;
      steamId: string;
      planted: number;
      detonations: number;
      killHits: number;
    }>;
  };
};

const TS_RE =
  /^\[(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2}):(\d{3})\]/;

const FOB_HIT_RE =
  /TakeDamage\(\):\s+(BP_FOBRadio_[A-Za-z0-9_]+):\s+([\d.]+)\s+damage taken by causer\s+([A-Za-z0-9_]+)\s+instigator\s+(.+?)\s+\(Online IDs:.*?steam:\s*(\d+)\)\s+health remaining\s+([\d.]+)/i;

const MINE_PLANT_RE =
  /Deployable\s+(BP_Deployable_[A-Za-z0-9]*Mine[A-Za-z0-9_]*)\s+spawned for team\s+(\d+)\s+at location\s+(\{[^}]+\})\s+by player\s+(.+?)\s+\(ID:\s*\d+,\s*OnlineIDs:.*?steam:\s*(\d+)\)/i;

const MINE_DETON_RE =
  /TakeDamage\(\):\s+([A-Za-z0-9_]+):\s+([\d.]+)\s+damage taken by causer\s+(BP_Deployable_[A-Za-z0-9]*Mine[A-Za-z0-9_]*)\s+instigator\s+(.+?)\s+\(Online IDs:.*?steam:\s*(\d+)\)\s+health remaining\s+([\d.]+)/i;

function logRoot(): string {
  const env = process.env.BB_LOG_CACHE_ROOT?.trim();
  if (env) return env;
  return path.join(process.cwd(), "scripts", "_tmp_squad_logs");
}

function parseTs(line: string): string | null {
  const m = TS_RE.exec(line);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, ms] = m;
  // log is UTC-ish server time as written; keep as ISO-ish without TZ guess
  return `${y}-${mo}-${d}T${h}:${mi}:${s}.${ms}Z`;
}

function shortWeapon(causer: string): string {
  return causer
    .replace(/^BP_/, "")
    .replace(/_C_\d+$/, "")
    .replace(/_Proj\d*/gi, "")
    .replace(/_C$/, "");
}

function mineKind(id: string): string {
  const m = /BP_Deployable_([A-Za-z0-9]+Mine)/i.exec(id);
  return m?.[1] || id.replace(/^BP_Deployable_/, "").replace(/_C_\d+$/, "");
}

function fobKind(id: string): string {
  const m = /BP_FOBRadio_([A-Za-z0-9]+)/i.exec(id);
  return m?.[1] || "FOBRadio";
}

function listLogFiles(server: string, maxFiles: number): string[] {
  const dir = path.join(logRoot(), server);
  if (!fs.existsSync(dir)) return [];
  const names = fs.readdirSync(dir).filter((n) => n.startsWith("SquadGame") && n.endsWith(".log"));
  const full = names.map((n) => path.join(dir, n));
  full.sort((a, b) => {
    try {
      return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
    } catch {
      return 0;
    }
  });
  return full.slice(0, maxFiles);
}

function scanFile(
  filePath: string,
  server: string,
  out: {
    fobHits: FobHit[];
    plants: MinePlant[];
    dets: MineDetonation[];
  }
) {
  let text: string;
  try {
    const st = fs.statSync(filePath);
    // cap huge files: last ~80MB
    const max = 80 * 1024 * 1024;
    if (st.size > max) {
      const fd = fs.openSync(filePath, "r");
      const buf = Buffer.alloc(max);
      fs.readSync(fd, buf, 0, max, st.size - max);
      fs.closeSync(fd);
      text = buf.toString("utf8");
      const nl = text.indexOf("\n");
      if (nl >= 0) text = text.slice(nl + 1);
    } else {
      text = fs.readFileSync(filePath, "utf8");
    }
  } catch {
    return;
  }

  for (const line of text.split(/\r?\n/)) {
    if (!line.includes("LogSquad") && !line.includes("LogSquadTrace")) continue;
    const at = parseTs(line) || "";

    if (line.includes("BP_FOBRadio") && line.includes("damage taken")) {
      const m = FOB_HIT_RE.exec(line);
      if (m) {
        const [, fobId, dmg, causer, nickRaw, steam, hp] = m;
        out.fobHits.push({
          at,
          server,
          fobId,
          fobKind: fobKind(fobId),
          damage: Number(dmg) || 0,
          healthLeft: Number(hp) || 0,
          nick: nickRaw.trim(),
          steamId: steam,
          causer,
          weapon: shortWeapon(causer),
        });
      }
      continue;
    }

    if (line.includes("Deployable") && /Mine/i.test(line) && line.includes("by player")) {
      const m = MINE_PLANT_RE.exec(line);
      if (m) {
        const [, mineId, team, loc, nickRaw, steam] = m;
        out.plants.push({
          at,
          server,
          mineId,
          mineKind: mineKind(mineId),
          team,
          nick: nickRaw.trim(),
          steamId: steam,
          loc,
        });
      }
      continue;
    }

    if (line.includes("damage taken") && /Mine/i.test(line) && line.includes("causer BP_Deployable_")) {
      const m = MINE_DETON_RE.exec(line);
      if (m) {
        const [, target, dmg, mineId, nickRaw, steam, hp] = m;
        const healthLeft = Number(hp) || 0;
        out.dets.push({
          at,
          server,
          mineId,
          mineKind: mineKind(mineId),
          nick: nickRaw.trim(),
          steamId: steam,
          target: shortWeapon(target),
          damage: Number(dmg) || 0,
          killed: healthLeft <= 0.05,
        });
      }
    }
  }
}

function aggregateFob(hits: FobHit[]): {
  summaries: FobSummary[];
  topDamagers: FobSummary["topDamagers"];
} {
  const byFob = new Map<string, FobHit[]>();
  for (const h of hits) {
    const k = `${h.server}|${h.fobId}`;
    if (!byFob.has(k)) byFob.set(k, []);
    byFob.get(k)!.push(h);
  }

  const summaries: FobSummary[] = [];
  const global = new Map<string, { nick: string; steamId: string; damage: number; hits: number }>();

  for (const [, list] of byFob) {
    list.sort((a, b) => a.at.localeCompare(b.at));
    const damagers = new Map<string, { nick: string; steamId: string; damage: number; hits: number }>();
    let total = 0;
    for (const h of list) {
      total += h.damage;
      const key = h.steamId || h.nick;
      const cur = damagers.get(key) || {
        nick: h.nick,
        steamId: h.steamId,
        damage: 0,
        hits: 0,
      };
      cur.damage += h.damage;
      cur.hits += 1;
      damagers.set(key, cur);

      const g = global.get(key) || {
        nick: h.nick,
        steamId: h.steamId,
        damage: 0,
        hits: 0,
      };
      g.damage += h.damage;
      g.hits += 1;
      global.set(key, g);
    }
    const last = list[list.length - 1] || null;
    const top = [...damagers.values()].sort((a, b) => b.damage - a.damage).slice(0, 8);
    summaries.push({
      fobId: list[0].fobId,
      fobKind: list[0].fobKind,
      server: list[0].server,
      hits: list.length,
      totalDamage: Math.round(total * 100) / 100,
      lastHealth: last ? last.healthLeft : null,
      likelyDestroyed: last != null && last.healthLeft <= 0.05,
      topDamagers: top.map((t) => ({
        ...t,
        damage: Math.round(t.damage * 100) / 100,
      })),
      lastHit: last,
    });
  }

  summaries.sort((a, b) => b.totalDamage - a.totalDamage);
  const topDamagers = [...global.values()]
    .sort((a, b) => b.damage - a.damage)
    .slice(0, 20)
    .map((t) => ({ ...t, damage: Math.round(t.damage * 100) / 100 }));

  return { summaries, topDamagers };
}

function aggregateMines(plants: MinePlant[], dets: MineDetonation[]) {
  const map = new Map<
    string,
    { nick: string; steamId: string; planted: number; detonations: number; killHits: number }
  >();
  for (const p of plants) {
    const k = p.steamId || p.nick;
    const cur = map.get(k) || {
      nick: p.nick,
      steamId: p.steamId,
      planted: 0,
      detonations: 0,
      killHits: 0,
    };
    cur.planted += 1;
    map.set(k, cur);
  }
  for (const d of dets) {
    const k = d.steamId || d.nick;
    const cur = map.get(k) || {
      nick: d.nick,
      steamId: d.steamId,
      planted: 0,
      detonations: 0,
      killHits: 0,
    };
    cur.detonations += 1;
    if (d.killed) cur.killHits += 1;
    map.set(k, cur);
  }
  return [...map.values()].sort(
    (a, b) => b.planted + b.detonations - (a.planted + a.detonations)
  );
}

function scanLogs(opts?: {
  servers?: string[];
  maxFilesPerServer?: number;
}): {
  root: string;
  filesScanned: string[];
  fobHits: FobHit[];
  plants: MinePlant[];
  dets: MineDetonation[];
  maxFiles: number;
} {
  const servers = opts?.servers?.length ? opts.servers : ["TR1", "TR2"];
  const maxFiles = opts?.maxFilesPerServer ?? 5;
  const root = logRoot();
  const filesScanned: string[] = [];
  const fobHits: FobHit[] = [];
  const plants: MinePlant[] = [];
  const dets: MineDetonation[] = [];

  for (const server of servers) {
    for (const f of listLogFiles(server, maxFiles)) {
      filesScanned.push(path.relative(root, f).replace(/\\/g, "/"));
      scanFile(f, server, { fobHits, plants, dets });
    }
  }

  return { root, filesScanned, fobHits, plants, dets, maxFiles };
}

export async function buildFobMinesLab(opts?: {
  servers?: string[];
  maxFilesPerServer?: number;
}): Promise<FobMinesLabBoard> {
  const { root, filesScanned, fobHits, plants, dets, maxFiles } = scanLogs(opts);

  fobHits.sort((a, b) => b.at.localeCompare(a.at));
  plants.sort((a, b) => b.at.localeCompare(a.at));
  dets.sort((a, b) => b.at.localeCompare(a.at));

  const { summaries, topDamagers } = aggregateFob(fobHits);

  return {
    updatedAt: new Date().toISOString(),
    logRoot: root,
    filesScanned,
    notes: [
      "FOB: урон по рации (TakeDamage). Кто поставил / кто вкопал лопатой — в логах нет.",
      "Мины: spawn «by player» = кто поставил; detonations = урон от мины (instigator обычно ставивший).",
      `Скан: live + до ${maxFiles - 1} бэкапов на сервер, хвост больших файлов ~80MB.`,
    ],
    fob: {
      hits: fobHits.slice(0, 200),
      summaries: summaries.slice(0, 40),
      topDamagers,
    },
    mines: {
      plants: plants.slice(0, 200),
      detonations: dets.slice(0, 200),
      byPlanter: aggregateMines(plants, dets).slice(0, 40),
    },
  };
}

/** Строка рейтинга сапёра / FOB по логам TR (BlackBerry). */
export type SapperRatingRow = {
  place: number;
  nick: string;
  steamId: string;
  /** Мины поставлено */
  minesPlanted: number;
  /** Уникальных мин, которые хоть раз нанесли урон */
  minesTriggered: number;
  /** Событий урона от мин */
  mineHits: number;
  /** Убийств / добиваний миной (health → 0) */
  mineKills: number;
  /** Суммарный урон от мин */
  mineDamage: number;
  /** Урон по FOB-рациям */
  fobDamage: number;
  /** Хитов по FOB */
  fobHits: number;
  /** Сколько раз последний хит по FOB (likely destroy) */
  fobsDestroyed: number;
  /** mineDamage + fobDamage */
  totalDamage: number;
  /** Условный score для сортировки по умолчанию */
  score: number;
};

export type BbSapperRatingBoard = {
  updatedAt: string;
  filesScanned: string[];
  notes: string[];
  membersMatched: number;
  rows: SapperRatingRow[];
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Рейтинг игроков BlackBerry по минам / FOB из логов TR1+TR2.
 * `bbSteamIds` — состав клана; строки только по ним (ник подтягиваем из roster).
 */
export function buildBbSapperRating(
  bbRoster: Array<{ steamId: string; nick: string }>,
  opts?: { servers?: string[]; maxFilesPerServer?: number }
): BbSapperRatingBoard {
  const { filesScanned, fobHits, plants, dets, maxFiles } = scanLogs(opts);
  const bySteam = new Map(
    bbRoster
      .filter((m) => m.steamId)
      .map((m) => [m.steamId, { nick: m.nick || m.steamId, steamId: m.steamId }])
  );

  type Acc = {
    nick: string;
    steamId: string;
    minesPlanted: number;
    triggeredIds: Set<string>;
    mineHits: number;
    mineKills: number;
    mineDamage: number;
    fobDamage: number;
    fobHits: number;
    fobsDestroyed: number;
  };

  const acc = new Map<string, Acc>();

  function ensure(steamId: string, nickHint: string): Acc | null {
    const member = bySteam.get(steamId);
    if (!member) return null;
    let cur = acc.get(steamId);
    if (!cur) {
      cur = {
        nick: member.nick || nickHint,
        steamId,
        minesPlanted: 0,
        triggeredIds: new Set(),
        mineHits: 0,
        mineKills: 0,
        mineDamage: 0,
        fobDamage: 0,
        fobHits: 0,
        fobsDestroyed: 0,
      };
      acc.set(steamId, cur);
    } else if (nickHint && nickHint !== steamId) {
      cur.nick = nickHint;
    }
    return cur;
  }

  for (const p of plants) {
    const cur = ensure(p.steamId, p.nick);
    if (cur) cur.minesPlanted += 1;
  }

  for (const d of dets) {
    const cur = ensure(d.steamId, d.nick);
    if (!cur) continue;
    cur.mineHits += 1;
    cur.mineDamage += d.damage;
    if (d.killed) cur.mineKills += 1;
    if (d.mineId) cur.triggeredIds.add(d.mineId);
  }

  // FOB destroy attribution: last hit when health ~0
  const byFob = new Map<string, FobHit[]>();
  for (const h of fobHits) {
    const k = `${h.server}|${h.fobId}`;
    if (!byFob.has(k)) byFob.set(k, []);
    byFob.get(k)!.push(h);
  }
  for (const list of byFob.values()) {
    list.sort((a, b) => a.at.localeCompare(b.at));
    const last = list[list.length - 1];
    if (last && last.healthLeft <= 0.05) {
      const cur = ensure(last.steamId, last.nick);
      if (cur) cur.fobsDestroyed += 1;
    }
  }

  for (const h of fobHits) {
    const cur = ensure(h.steamId, h.nick);
    if (!cur) continue;
    cur.fobHits += 1;
    cur.fobDamage += h.damage;
  }

  // Include BB members with zero activity so roster is complete
  for (const m of bySteam.values()) {
    if (!acc.has(m.steamId)) {
      acc.set(m.steamId, {
        nick: m.nick,
        steamId: m.steamId,
        minesPlanted: 0,
        triggeredIds: new Set(),
        mineHits: 0,
        mineKills: 0,
        mineDamage: 0,
        fobDamage: 0,
        fobHits: 0,
        fobsDestroyed: 0,
      });
    }
  }

  const rowsRaw = [...acc.values()].map((a) => {
    const mineDamage = round2(a.mineDamage);
    const fobDamage = round2(a.fobDamage);
    const totalDamage = round2(mineDamage + fobDamage);
    const minesTriggered = a.triggeredIds.size;
    const score =
      a.minesPlanted * 10 +
      minesTriggered * 25 +
      a.mineKills * 40 +
      mineDamage +
      fobDamage * 2 +
      a.fobsDestroyed * 200;
    return {
      place: 0,
      nick: a.nick,
      steamId: a.steamId,
      minesPlanted: a.minesPlanted,
      minesTriggered,
      mineHits: a.mineHits,
      mineKills: a.mineKills,
      mineDamage,
      fobDamage,
      fobHits: a.fobHits,
      fobsDestroyed: a.fobsDestroyed,
      totalDamage,
      score: round2(score),
    } satisfies SapperRatingRow;
  });

  rowsRaw.sort((a, b) => b.score - a.score || b.totalDamage - a.totalDamage);
  const rows = rowsRaw.map((r, i) => ({ ...r, place: i + 1 }));

  return {
    updatedAt: new Date().toISOString(),
    filesScanned,
    notes: [
      "Только состав BlackBerry. Источник — логи TR1/TR2 (тренировки).",
      "Мины: поставлено / сработало (уник. мины с уроном) / урон / киллы миной.",
      "FOB: урон по рации + «снёс» = последний хит до 0 HP. Кто поставил/вкопал FOB — в логах нет.",
      `Скан: до ${maxFiles} файлов на сервер, хвост ~80MB.`,
    ],
    membersMatched: bySteam.size,
    rows,
  };
}
