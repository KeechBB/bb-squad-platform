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

/** Slim public ladder stores kills/deaths as numbers; full ledger uses event arrays. */
function slimCombatField(v: unknown): number | unknown[] {
  if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, v);
  if (Array.isArray(v)) return v;
  return 0;
}

/** Write time of the public ladder. Readers compare this instead of trusting a file or a page snapshot. */
export async function loadPublicRpUpdatedAt(): Promise<string | null> {
  if (!dbReadEnabled()) return null;
  try {
    const meta = await prisma.rpMeta.findUnique({
      where: { scope: "PUBLIC" },
      select: { updatedAt: true },
    });
    return meta?.updatedAt ? meta.updatedAt.toISOString() : null;
  } catch (e) {
    console.warn("[rpDbRead] public stamp skip", e);
    return null;
  }
}

/** RP board without matchesJson — home top /public overlay (13k full ladder OOMs workers). */
export async function loadPublicRpTopFromDb(
  limit = 10
): Promise<
  Array<{
    nick: string;
    rp: number;
    rankLabel: string;
    rankKey: string;
    predatorPlace: number | null;
  }>
> {
  if (!dbReadEnabled()) return [];
  try {
    const rows = await prisma.rpLadderPlayer.findMany({
      where: { scope: "PUBLIC" },
      orderBy: [{ place: "asc" }, { rp: "desc" }],
      take: Math.max(1, Math.min(2000, limit)),
      select: {
        nick: true,
        rp: true,
        rankLabel: true,
        rankKey: true,
        predatorPlace: true,
      },
    });
    return rows.map((r) => ({
      nick: r.nick,
      rp: r.rp,
      rankLabel: r.rankLabel,
      rankKey: r.rankKey,
      predatorPlace: r.predatorPlace,
    }));
  } catch (e) {
    console.warn("[rpDbRead] public top skip", e);
    return [];
  }
}

/** One player's official public RP. Same row the home top and /public use. */
export async function loadPublicRpOneFromDb(nick: string): Promise<{
  nick: string;
  rp: number;
  rankLabel: string;
  rankKey: string;
  predatorPlace: number | null;
} | null> {
  if (!dbReadEnabled()) return null;
  const key = nickKey(nick);
  if (!key) return null;
  try {
    const row = await prisma.rpLadderPlayer.findUnique({
      where: { scope_nickKey: { scope: "PUBLIC", nickKey: key } },
      select: {
        nick: true,
        rp: true,
        rankLabel: true,
        rankKey: true,
        predatorPlace: true,
      },
    });
    if (!row || !Number.isFinite(row.rp)) return null;
    return {
      nick: row.nick,
      rp: row.rp,
      rankLabel: row.predatorPlace
        ? `PREDATOR #${row.predatorPlace}`
        : row.rankLabel,
      rankKey: row.predatorPlace ? "predator" : row.rankKey,
      predatorPlace: row.predatorPlace,
    };
  } catch (e) {
    console.warn("[rpDbRead] public one skip", e);
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
        matches: ms.map((m) => {
          const kills = slimCombatField(m.kills);
          const deaths = slimCombatField(m.deaths);
          const noks = slimCombatField(m.noks);
          const revives = slimCombatField(m.revives);
          return {
            id: String(m.id || ""),
            map: String(m.map || ""),
            date: String(m.date || ""),
            net: Number(m.net || 0),
            // publicCombat.countStat accepts number | array length
            kills: kills as RpPlayer["matches"][number]["kills"],
            deaths: deaths as RpPlayer["matches"][number]["deaths"],
            noks: noks as RpPlayer["matches"][number]["noks"],
            revives: revives as RpPlayer["matches"][number]["revives"],
            dmg: typeof m.dmg === "number" ? m.dmg : undefined,
            vehicleKills:
              typeof m.vehicleKills === "number"
                ? Math.max(0, Math.floor(m.vehicleKills))
                : undefined,
            won: typeof m.won === "boolean" ? m.won : null,
          };
        }),
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
