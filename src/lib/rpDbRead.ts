/**
 * Phase 10: slim RP ladder from Postgres (TRAIN / PUBLIC).
 * Full event ledger stays on disk. Disable: BB_RP_DB_READ=0
 */
import { prisma } from "@/lib/prisma";
import type { RpLadder, RpLedger, RpPlayer } from "@/lib/trainRp";

export type RpDbScope = "TRAIN" | "PUBLIC";

function dbReadEnabled(): boolean {
  const v = (process.env.BB_RP_DB_READ || "1").trim().toLowerCase();
  return v !== "0" && v !== "false" && v !== "no";
}

function nickKey(n: string) {
  return String(n || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

type SlimMatch = Record<string, unknown> & {
  id?: string;
  map?: string;
  date?: string;
  net?: number;
};

async function loadScopeRows(scope: RpDbScope) {
  const meta = await prisma.rpMeta.findUnique({ where: { scope } });
  if (!meta) return null;
  const [players, matches] = await Promise.all([
    prisma.rpLadderPlayer.findMany({
      where: { scope },
      orderBy: [{ place: "asc" }, { rp: "desc" }],
    }),
    prisma.rpScoredMatch.findMany({
      where: { scope },
      orderBy: { date: "asc" },
    }),
  ]);
  if (!players.length) return null;
  return { meta, players, matches };
}

export async function loadRpLadderFromDb(
  scope: RpDbScope
): Promise<RpLadder | null> {
  if (!dbReadEnabled()) return null;
  try {
    const rows = await loadScopeRows(scope);
    if (!rows) return null;
    const { meta, players, matches } = rows;

    const playersOut: RpLadder["players"] = {};
    const leaderboard: RpLadder["leaderboard"] = [];
    for (const p of players) {
      const ms = (Array.isArray(p.matchesJson) ? p.matchesJson : []) as SlimMatch[];
      const key = p.nickKey || nickKey(p.nick);
      playersOut[key] = {
        nick: p.nick,
        rp: p.rp,
        rankLabel: p.rankLabel,
        rankKey: p.rankKey,
        predatorPlace: p.predatorPlace,
        matches: ms.map((m) => ({
          id: String(m.id || ""),
          map: String(m.map || ""),
          date: String(m.date || ""),
          net: Number(m.net || 0),
        })),
      };
      leaderboard.push({
        nick: p.nick,
        rp: p.rp,
        rankLabel: p.rankLabel,
        rankKey: p.rankKey,
        predatorPlace: p.predatorPlace ?? null,
      });
    }

    return {
      version: meta.version,
      startRp: meta.startRp,
      step: meta.step,
      radiant3Max: meta.radiant3Max,
      pMax: meta.pMax ?? 0,
      updatedAt: meta.updatedAt.toISOString(),
      matches: matches.map((m) => {
        const raw = (m.rawJson || {}) as Record<string, unknown>;
        return {
          id: m.matchKey,
          map: m.mapName || String(raw.map || ""),
          date: m.date || String(raw.date || ""),
          netByNick: (raw.netByNick as Record<string, number>) || {},
          giveUpKills: raw.giveUpKills as number | undefined,
          teamkills: raw.teamkills as number | undefined,
          revives: raw.revives as number | undefined,
        };
      }),
      players: playersOut,
      leaderboard,
    };
  } catch (e) {
    console.warn("[rpDbRead] ladder skip", scope, e);
    return null;
  }
}

/** Public slim — RpLedger shape for leaderboard / profile header (no events). */
export async function loadPublicRpLadderFromDb(): Promise<RpLedger | null> {
  if (!dbReadEnabled()) return null;
  try {
    const rows = await loadScopeRows("PUBLIC");
    if (!rows) return null;
    const { meta, players, matches } = rows;

    const playersOut: Record<string, RpPlayer> = {};
    const leaderboard: RpLedger["leaderboard"] = [];
    for (const p of players) {
      const ms = (Array.isArray(p.matchesJson) ? p.matchesJson : []) as SlimMatch[];
      const key = p.nickKey || nickKey(p.nick);
      playersOut[key] = {
        nick: p.nick,
        rp: p.rp,
        rankLabel: p.rankLabel,
        rankKey: p.rankKey,
        predatorPlace: p.predatorPlace,
        matches: ms.map((m) => ({
          id: String(m.id || ""),
          map: String(m.map || ""),
          date: String(m.date || ""),
          net: Number(m.net || 0),
          kills: [],
          deaths: [],
          noks: [],
          revives: [],
          dmg: typeof m.dmg === "number" ? m.dmg : undefined,
          won: typeof m.won === "boolean" ? m.won : null,
        })),
      };
      leaderboard.push({
        nick: p.nick,
        rp: p.rp,
        rankLabel: p.rankLabel,
        rankKey: p.rankKey,
        predatorPlace: p.predatorPlace ?? null,
      });
    }

    return {
      version: meta.version,
      startRp: meta.startRp,
      step: meta.step,
      radiant3Max: meta.radiant3Max,
      pMax: meta.pMax ?? 0,
      updatedAt: meta.updatedAt.toISOString(),
      epoch: meta.epoch || undefined,
      historyOnly: meta.historyOnly || undefined,
      matches: matches.map((m) => ({
        id: m.matchKey,
        map: m.mapName || "",
        date: m.date || "",
        netByNick: {},
        events: [],
      })),
      players: playersOut,
      leaderboard,
    };
  } catch (e) {
    console.warn("[rpDbRead] public ladder skip", e);
    return null;
  }
}
