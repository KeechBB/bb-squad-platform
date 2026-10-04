/**
 * Server-only MVP board builder (reads VPS kv-cache).
 * Keep out of client components — they import types from homeMvp.ts.
 */
import {
  emptyHomeMvpBoard,
  pickMvps,
  type HomeMvpBoardData,
  type HomeMvpLane,
  type HomeMvpRow,
  type MvpBlock,
} from "@/lib/homeMvp";

type Acc = {
  nick: string;
  medic: number;
  killer: number;
  war: number;
  anti: number;
};

type StatRow = {
  nick: string;
  res?: number;
  nok?: number;
  kills?: number;
  deaths?: number;
  dmg?: number;
};

async function loadJson<T = unknown>(relPath: string): Promise<T> {
  const { loadKvJsonCached } = await import("@/lib/kvLocal");
  const rel = relPath.replace(/^\//, "").replace(/^https?:\/\/[^/]+\//, "");
  const data = await loadKvJsonCached<T>(rel);
  if (data == null) throw new Error(`KV missing on disk: ${rel}`);
  return data;
}

function toRow(p: Acc): HomeMvpRow {
  return {
    nick: p.nick,
    medic: p.medic,
    killer: p.killer,
    war: p.war,
    anti: p.anti,
    medals: p.medic + p.killer + p.war,
  };
}

function emptyAcc(nick: string): Acc {
  return { nick, medic: 0, killer: 0, war: 0, anti: 0 };
}

function bump(
  map: Map<string, Acc>,
  nick: string,
  field: "medic" | "killer" | "war" | "anti"
) {
  const key = nick.trim().toLowerCase();
  if (!key) return;
  const cur = map.get(key) || emptyAcc(nick.trim());
  if (nick.trim().length > cur.nick.length) cur.nick = nick.trim();
  cur[field] += 1;
  map.set(key, cur);
}

function applyMvpBlock(map: Map<string, Acc>, block: MvpBlock | null | undefined) {
  if (!block) return;
  for (const nick of block.medic || []) bump(map, nick, "medic");
  for (const nick of block.killer || []) bump(map, nick, "killer");
  for (const nick of block.damage || []) bump(map, nick, "war");
  for (const nick of block.antiDeath || []) bump(map, nick, "anti");
}

function laneFromMap(map: Map<string, Acc>): HomeMvpLane {
  const rows = Array.from(map.values()).map(toRow);
  const glory = rows
    .filter((p) => p.medals > 0)
    .sort(
      (a, b) =>
        b.medals - a.medals ||
        b.war - a.war ||
        b.killer - a.killer ||
        a.nick.localeCompare(b.nick, "ru", { sensitivity: "base" })
    )
    .slice(0, 3);

  const anti = rows
    .filter((p) => p.anti > 0)
    .sort(
      (a, b) =>
        b.anti - a.anti ||
        a.medals - b.medals ||
        a.nick.localeCompare(b.nick, "ru", { sensitivity: "base" })
    )
    .slice(0, 3);

  return { glory, anti };
}

async function loadTrainLane(): Promise<HomeMvpLane> {
  const index = await loadJson<{ months?: { url?: string }[] }>(
    "data/training-index.json"
  );
  const map = new Map<string, Acc>();
  const months = (index.months || []) as { url?: string }[];

  for (const meta of months) {
    if (!meta.url) continue;
    let month: { matches?: unknown[] };
    try {
      month = await loadJson(meta.url.replace(/^\//, ""));
    } catch {
      continue;
    }
    const matches = (month.matches || []) as {
      status?: string;
      playersUrl?: string;
    }[];

    await Promise.all(
      matches.map(async (m) => {
        if (!m.playersUrl || m.status === "upcoming") return;
        try {
          const players = await loadJson<{
            players?: StatRow[];
            teamA?: StatRow[];
            teamB?: StatRow[];
            mvp?: { train?: MvpBlock };
          }>(m.playersUrl.replace(/^\//, ""));
          const list: StatRow[] = players.players?.length
            ? players.players
            : [...(players.teamA || []), ...(players.teamB || [])];
          const mvp =
            (players.mvp && players.mvp.train) ||
            pickMvps(list.filter((p) => p && p.nick));
          applyMvpBlock(map, mvp);
        } catch {
          /* skip */
        }
      })
    );
  }

  return laneFromMap(map);
}

async function loadKvStackLane(
  stackWanted: "Main" | "Junior"
): Promise<HomeMvpLane> {
  const index = await loadJson<{ months?: { url?: string }[] }>(
    "data/index.json"
  );
  const months = (index.months || []) as { url?: string }[];
  const map = new Map<string, Acc>();

  for (const meta of months) {
    if (!meta.url) continue;
    let month: { matches?: unknown[] };
    try {
      month = await loadJson(meta.url.replace(/^\//, ""));
    } catch {
      continue;
    }

    const matches = (month.matches || []) as {
      status?: string;
      stack?: string;
      playersUrl?: string;
    }[];

    await Promise.all(
      matches.map(async (m) => {
        if (!m.playersUrl || m.status === "upcoming") return;
        if (
          String(m.stack || "").toLowerCase() !== stackWanted.toLowerCase()
        ) {
          return;
        }
        try {
          const players = await loadJson<{
            mvp?: { r1?: MvpBlock; r2?: MvpBlock };
            r1?: StatRow[];
            r2?: StatRow[];
          }>(m.playersUrl.replace(/^\//, ""));
          const mvp = players.mvp || {};
          applyMvpBlock(map, mvp.r1);
          applyMvpBlock(map, mvp.r2);
          if (!mvp.r1 && !mvp.r2 && Array.isArray(players.r1)) {
            applyMvpBlock(map, pickMvps(players.r1));
            if (Array.isArray(players.r2)) {
              applyMvpBlock(map, pickMvps(players.r2));
            }
          }
        } catch {
          /* skip */
        }
      })
    );
  }

  return laneFromMap(map);
}

export async function buildHomeMvpBoard(): Promise<HomeMvpBoardData> {
  try {
    const [train, main, junior] = await Promise.all([
      loadTrainLane(),
      loadKvStackLane("Main"),
      loadKvStackLane("Junior"),
    ]);
    return {
      train,
      main,
      junior,
      source: "vps-disk",
      updatedAt: new Date().toISOString(),
    };
  } catch {
    return emptyHomeMvpBoard();
  }
}
