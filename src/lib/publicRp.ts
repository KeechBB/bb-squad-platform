/**
 * Public (PB1) Respect Points — same ladder UI as train RP.
 * Hot path uses slim `data/public/rp-ladder.json` (~1–2MB).
 * Full `rp-ledger.json` (~80MB+) only for rare drilldowns — NEVER cached in process
 * memory (parsed object blows RAM on a 4GB VPS).
 */
import { rpRankFromScore, type RpLeaderRow, type RpLedger, type RpPlayer } from "@/lib/trainRp";

const KV_BASES = [
  process.env.KV_DATA_BASE,
].filter(Boolean) as string[];

const CACHE_TTL_MS = 5 * 60 * 1000;
const FULL_PLAYER_TTL_MS = 120_000;
let ladderMem: { at: number; data: RpLedger | null } | null = null;
/** Per-nick drilldown extracts — do not keep full ledger resident. */
const fullPlayerMem = new Map<string, { at: number; data: RpPlayer | null }>();

function nickKey(n: string) {
  return String(n || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

async function fetchJson(url: string) {
  const res = await fetch(url, { next: { revalidate: 120 } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Public rating starts 2026-10-03; reject pre-epoch / non-history ledgers. */
const PUBLIC_RP_EPOCH = (process.env.PUBLIC_RP_EPOCH || "2026-10-03").trim();

function isCurrentPublicLedger(data: RpLedger | null | undefined): boolean {
  if (!data) return false;
  const nPlayers = data.players ? Object.keys(data.players).length : 0;
  if (!nPlayers && !(data.leaderboard?.length ?? 0)) return false;
  if (data.historyOnly && data.epoch && data.epoch >= PUBLIC_RP_EPOCH) {
    return true;
  }
  const matches = data.matches || [];
  if (!matches.length) return false;
  if (matches.some((m) => m.date && m.date < PUBLIC_RP_EPOCH)) return false;
  return matches.every((m) => !m.date || m.date >= PUBLIC_RP_EPOCH);
}

function ledgerFreshness(data: RpLedger): number {
  // Prefer newest file by updatedAt. Do NOT substring-match formula:
  // old ledgers contain "nok=Wound downs" and would beat a fresher copy.
  return Date.parse(String(data.updatedAt || "")) || 0;
}

async function readJsonFile(path: string): Promise<RpLedger | null> {
  try {
    const { readFile } = await import("fs/promises");
    return JSON.parse(await readFile(path, "utf8")) as RpLedger;
  } catch {
    return null;
  }
}

/** Keep only the freshest valid copy — never retain every parsed candidate. */
async function loadBestPublicJson(relUnderData: string): Promise<RpLedger | null> {
  const { join } = await import("path");
  const cwd = process.cwd();
  const diskPaths = [
    join(cwd, "data", "kv-cache", "data", relUnderData),
    join(cwd, "data", relUnderData),
    join(cwd, "..", "KV", "public", "data", relUnderData),
    join(cwd, "..", "KV", "data", relUnderData),
  ];

  let best: RpLedger | null = null;
  let bestScore = -1;

  for (const p of diskPaths) {
    const data = await readJsonFile(p);
    if (!data || !isCurrentPublicLedger(data)) continue;
    const score = ledgerFreshness(data);
    if (score > bestScore) {
      best = data;
      bestScore = score;
    }
  }

  if (!best) {
    for (const base of KV_BASES) {
      try {
        const data = (await fetchJson(
          `${base.replace(/\/$/, "")}/data/${relUnderData}`
        )) as RpLedger;
        if (!isCurrentPublicLedger(data)) continue;
        const score = ledgerFreshness(data);
        if (score > bestScore) {
          best = data;
          bestScore = score;
        }
      } catch {
        /* next */
      }
    }
  }

  return best;
}

/** Slim public ladder (~1MB) — rating table / aggregates. */
export async function loadPublicRpLadder(): Promise<RpLedger | null> {
  const now = Date.now();
  if (ladderMem && now - ladderMem.at < CACHE_TTL_MS) return ladderMem.data;

  const data = await loadBestPublicJson("public/rp-ladder.json");
  ladderMem = { at: now, data };
  return data;
}

/**
 * Full ledger — drilldown only. No process-wide cache (file can be 80MB+ on disk;
 * JSON.parse residencies are several× that).
 */
export async function loadPublicRpLedger(): Promise<RpLedger | null> {
  return loadBestPublicJson("public/rp-ledger.json");
}

/** Home / boards: slim ladder only — never pull full ledger. */
export async function buildPublicRpLeaderboard(): Promise<{
  rows: RpLeaderRow[];
  players: number;
  matches: number;
  updatedAt: string;
  available: boolean;
}> {
  const ledger = await loadPublicRpLadder();
  if (!ledger?.leaderboard?.length) {
    return {
      rows: [],
      players: 0,
      matches: 0,
      updatedAt: new Date().toISOString(),
      available: false,
    };
  }
  const rows: RpLeaderRow[] = ledger.leaderboard.map((r, i) => {
    const p = ledger.players[nickKey(r.nick)];
    const rank = r.predatorPlace
      ? { label: `PREDATOR #${r.predatorPlace}`, key: "predator" }
      : {
          label:
            r.rankLabel ||
            rpRankFromScore(r.rp, ledger.step, ledger.radiant3Max).label,
          key: r.rankKey,
        };
    return {
      nick: r.nick,
      rp: r.rp,
      rankLabel: rank.label,
      rankKey: rank.key,
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
    available: true,
  };
}

/**
 * Player public RP. Default = slim ladder (rp/rank + match counts).
 * Pass `{ full: true }` for drilldown (map/date/net + kill/death/revive events).
 * Slim matches are counts only — never use them for «детальный разбор».
 */
export async function lookupPlayerPublicRp(
  nick: string,
  opts?: { full?: boolean }
): Promise<RpPlayer | null> {
  const key = nickKey(nick);
  const pick = (ledger: RpLedger | null): RpPlayer | null => {
    if (!ledger?.players) return null;
    const direct = ledger.players[key];
    if (direct) return direct;
    for (const p of Object.values(ledger.players)) {
      if (nickKey(p.nick) === key) return p;
    }
    return null;
  };

  if (opts?.full) {
    const hit = fullPlayerMem.get(key);
    if (hit && Date.now() - hit.at < FULL_PLAYER_TTL_MS) return hit.data;
    const found = pick(await loadPublicRpLedger());
    fullPlayerMem.set(key, { at: Date.now(), data: found });
    if (fullPlayerMem.size > 200) {
      const drop = [...fullPlayerMem.entries()]
        .sort((a, b) => a[1].at - b[1].at)
        .slice(0, 60);
      for (const [k] of drop) fullPlayerMem.delete(k);
    }
    return found;
  }
  return pick(await loadPublicRpLadder());
}
