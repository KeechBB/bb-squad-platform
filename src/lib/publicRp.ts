/**
 * Public (PB1) Respect Points — same ladder UI as train RP.
 *
 * The public RP number lives in Postgres (`RpLadderPlayer` / `RpMeta`).
 * Home, /public and the profile all read that row. The JSON ladder is only
 * what the scorer writes before it copies the number into the database.
 * Drilldown events still come from data/public/rp-ledger.json.
 *
 * Do NOT read kv-cache / KV / github.io mirrors — those caused Farvort-class desync.
 * Full ledger is NEVER kept in process memory (JSON.parse residency blows RAM).
 */
import { rpRankFromScore, type RpLeaderRow, type RpLedger, type RpPlayer } from "@/lib/trainRp";

const FULL_PLAYER_TTL_MS = 120_000;
/** Held only while RpMeta.updatedAt is unchanged. A new score bumps the stamp. */
let ladderMem: { stamp: string; data: RpLedger | null } | null = null;
/** Per-nick drilldown extracts — do not keep full ledger resident. */
const fullPlayerMem = new Map<string, { at: number; data: RpPlayer | null }>();

function nickKey(n: string) {
  return String(n || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
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

async function readJsonFile(path: string): Promise<RpLedger | null> {
  try {
    const { readFile } = await import("fs/promises");
    return JSON.parse(await readFile(path, "utf8")) as RpLedger;
  } catch {
    return null;
  }
}

/**
 * Canonical public RP files only: `data/public/rp-*.json` under the platform cwd.
 * No multi-path "freshest wins" — one writer, one reader path.
 */
async function loadCanonicalPublicJson(
  fileName: "rp-ladder.json" | "rp-ledger.json"
): Promise<RpLedger | null> {
  const { join } = await import("path");
  const path = join(process.cwd(), "data", "public", fileName);
  const data = await readJsonFile(path);
  if (!data || !isCurrentPublicLedger(data)) return null;
  return data;
}

/**
 * Slim public ladder for combat / history.
 * Prefer canonical JSON (~12MB) — loading 13k DB rows × matchesJson OOMs PM2 workers
 * and took /public down with HTTP 500. RP numbers on /public are overlaid from DB separately.
 */
export async function loadPublicRpLadder(): Promise<RpLedger | null> {
  const { loadPublicRpUpdatedAt } = await import("@/lib/rpDbRead");
  const stamp = await loadPublicRpUpdatedAt();
  if (ladderMem && stamp && ladderMem.stamp === stamp) return ladderMem.data;

  try {
    const fromFile = await loadCanonicalPublicJson("rp-ladder.json");
    if (fromFile?.players && Object.keys(fromFile.players).length) {
      ladderMem = {
        stamp: stamp || fromFile.updatedAt || "",
        data: fromFile,
      };
      return fromFile;
    }
  } catch (e) {
    console.warn("[publicRp] ladder file skip", e);
  }

  try {
    const { loadPublicRpLadderFromDb } = await import("@/lib/rpDbRead");
    const fromDb = await loadPublicRpLadderFromDb();
    if (fromDb?.players && Object.keys(fromDb.players).length) {
      ladderMem = { stamp: stamp || fromDb.updatedAt || "", data: fromDb };
      return fromDb;
    }
  } catch (e) {
    console.warn("[publicRp] ladder db skip", e);
  }
  ladderMem = null;
  return null;
}

/** Cron/worker warm: touch slim ladder into process RAM (never full ledger). */
export async function warmPublicRpCaches(): Promise<{
  ladder: boolean;
  players: number;
}> {
  const data = await loadPublicRpLadder();
  return {
    ladder: Boolean(data?.leaderboard?.length),
    players: data?.leaderboard?.length || 0,
  };
}

/**
 * Full ledger — drilldown only. No process-wide cache (file can be 80MB+ on disk;
 * JSON.parse residencies are several× that). Prefer {@link extractPublicRpPlayerFromLedger}.
 */
export async function loadPublicRpLedger(): Promise<RpLedger | null> {
  return loadCanonicalPublicJson("rp-ledger.json");
}

/** One player from the public ledger. Never JSON.parse the whole file. */
async function extractPublicRpPlayerFromLedger(
  key: string
): Promise<RpPlayer | null> {
  const want = nickKey(key);
  if (!want) return null;
  const { join } = await import("path");
  const { extractRpPlayerAt } = await import("@/lib/rpPlayerExtract");
  return extractRpPlayerAt(
    join(process.cwd(), "data", "public", "rp-ledger.json"),
    want
  );
}

/** Home / boards: light DB board first — never require full matchesJson ladder. */
export async function buildPublicRpLeaderboard(): Promise<{
  rows: RpLeaderRow[];
  players: number;
  matches: number;
  updatedAt: string;
  available: boolean;
}> {
  try {
    const { loadPublicRpTopFromDb, loadPublicRpUpdatedAt } = await import(
      "@/lib/rpDbRead"
    );
    const [board, stamp] = await Promise.all([
      loadPublicRpTopFromDb(500),
      loadPublicRpUpdatedAt(),
    ]);
    if (board.length) {
      const rows: RpLeaderRow[] = board.map((r, i) => ({
        nick: r.nick,
        rp: r.rp,
        rankLabel: r.predatorPlace
          ? `PREDATOR #${r.predatorPlace}`
          : r.rankLabel,
        rankKey: r.predatorPlace ? "predator" : r.rankKey,
        predatorPlace: r.predatorPlace ?? null,
        place: i + 1,
        games: 0,
      }));
      return {
        rows,
        players: rows.length,
        matches: 0,
        updatedAt: stamp || new Date().toISOString(),
        available: true,
      };
    }
  } catch (e) {
    console.warn("[publicRp] light board skip", e);
  }

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

  const overlay = async (player: RpPlayer | null): Promise<RpPlayer | null> => {
    const { loadPublicRpOneFromDb } = await import("@/lib/rpDbRead");
    const live = await loadPublicRpOneFromDb(player?.nick || nick);
    if (!live) return player;
    const base: RpPlayer = player || {
      nick: live.nick,
      rp: live.rp,
      rankLabel: live.rankLabel,
      rankKey: live.rankKey,
      predatorPlace: live.predatorPlace,
      matches: [],
    };
    return {
      ...base,
      nick: live.nick || base.nick,
      rp: live.rp,
      rankLabel: live.rankLabel,
      rankKey: live.rankKey,
      predatorPlace: live.predatorPlace,
    };
  };

  if (opts?.full) {
    const hit = fullPlayerMem.get(key);
    if (hit && Date.now() - hit.at < FULL_PLAYER_TTL_MS) return overlay(hit.data);

    // Never JSON.parse the whole ledger (500MB+) — stream one player object.
    let found = await extractPublicRpPlayerFromLedger(key);
    if (!found) {
      // Fallback: tiny chance ledger key ≠ nickKey(display); walk slim only for existence.
      found = pick(await loadPublicRpLadder());
      if (found) {
        // Slim has counts, not kill arrays — still return so UI can say «нет детального разбора».
        found = { ...found };
      }
    }

    // Do not cache misses — a rewrite/race mid-read should retry next click.
    if (found) {
      found = (await overlay(found)) || found;
      fullPlayerMem.set(key, { at: Date.now(), data: found });
    }
    if (fullPlayerMem.size > 200) {
      const drop = [...fullPlayerMem.entries()]
        .sort((a, b) => a[1].at - b[1].at)
        .slice(0, 60);
      for (const [k] of drop) fullPlayerMem.delete(k);
    }
    return found;
  }
  return overlay(pick(await loadPublicRpLadder()));
}
