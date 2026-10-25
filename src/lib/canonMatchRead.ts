/**
 * Phase 3: rebuild KV-shaped JSON from CanonMatch (Postgres).
 * Merge over disk calendar so upcoming/cancel slots stay. Soft-fail → null.
 * Disable: BB_CANON_READ=0
 */
import { prisma } from "@/lib/prisma";
import type { CanonMatch, CanonMatchPlayer } from "@prisma/client";

export function canonReadEnabled(): boolean {
  const v = (process.env.BB_CANON_READ || "1").trim().toLowerCase();
  return v !== "0" && v !== "false" && v !== "no";
}

const TRAIN_MONTH = /^data\/training\/(\d{4}-\d{2})\.json$/i;
const CW_MONTH = /^data\/(\d{4}-\d{2})\.json$/i;
const TRAIN_PLAYERS = /^data\/training\/players\/([^/]+)\.json$/i;
const CW_PLAYERS = /^data\/players\/([^/]+)\.json$/i;

export function isCanonKvRel(rel: string): boolean {
  const r = rel.replace(/^\/+/, "");
  return (
    TRAIN_MONTH.test(r) ||
    CW_MONTH.test(r) ||
    TRAIN_PLAYERS.test(r) ||
    CW_PLAYERS.test(r)
  );
}

type MonthDoc = {
  month?: string;
  title?: string;
  note?: string;
  matches?: Record<string, unknown>[];
  [k: string]: unknown;
};

function playerPublic(p: CanonMatchPlayer): Record<string, unknown> {
  const raw =
    p.rawJson && typeof p.rawJson === "object" && !Array.isArray(p.rawJson)
      ? (p.rawJson as Record<string, unknown>)
      : {};
  return {
    nick: p.nick,
    kills: p.kills,
    deaths: p.deaths,
    nok: p.nok,
    res: p.res,
    ...(p.dmg != null ? { dmg: p.dmg } : {}),
    ...(p.vehicleKills != null ? { vehicleKills: p.vehicleKills } : {}),
    ...(typeof p.won === "boolean" ? { won: p.won } : {}),
    ...(raw.team != null ? { team: raw.team } : {}),
  };
}

function trainRowFromCanon(m: CanonMatch): Record<string, unknown> {
  return {
    id: m.legacyId,
    day: m.day,
    timeMsk: m.timeMsk || undefined,
    map: m.mapName,
    mode: m.mode || undefined,
    size: m.size || "—",
    server: m.serverLabel || m.serverKey || undefined,
    factionA: m.factionA || undefined,
    ticketsA: m.ticketsA ?? undefined,
    factionB: m.factionB || undefined,
    ticketsB: m.ticketsB ?? undefined,
    winner: m.winner || undefined,
    status: m.status || "done",
    playersUrl: m.legacyId
      ? `data/training/players/${m.legacyId}.json`
      : undefined,
    source: m.source === "LOG" ? "canon-log" : `canon-${m.source.toLowerCase()}`,
    serverKey: m.serverKey || undefined,
    note: m.note || undefined,
  };
}

function cwRowFromCanon(m: CanonMatch): Record<string, unknown> {
  return {
    id: m.legacyId,
    day: m.day,
    timeMsk: m.timeMsk || undefined,
    opp: m.opp || undefined,
    map: m.mapName,
    size: m.size || undefined,
    server: m.serverLabel || m.serverKey || undefined,
    rules: m.rules || undefined,
    stack: m.stack || undefined,
    status: m.status || undefined,
    meeting: m.meeting || undefined,
    r1: m.r1 || undefined,
    r2: m.r2 || undefined,
    note: m.note || undefined,
    playersUrl: m.legacyId ? `data/players/${m.legacyId}.json` : undefined,
    source: m.source === "LOG" ? "canon-log" : `canon-${m.source.toLowerCase()}`,
  };
}

function overlayRow(
  disk: Record<string, unknown>,
  fromCanon: Record<string, unknown>
): Record<string, unknown> {
  const out = { ...disk };
  for (const [k, v] of Object.entries(fromCanon)) {
    if (v === undefined || v === null || v === "") continue;
    out[k] = v;
  }
  return out;
}

async function mergeTrainMonth(
  ym: string,
  disk: MonthDoc | null
): Promise<MonthDoc | null> {
  const [year, month] = ym.split("-").map(Number);
  const rows = await prisma.canonMatch.findMany({
    where: { kind: "TRAIN", year, month },
    orderBy: [{ day: "asc" }, { timeMsk: "asc" }],
  });
  if (!rows.length) return disk;

  const byId = new Map(
    rows.filter((r) => r.legacyId).map((r) => [r.legacyId as string, r])
  );
  const base: MonthDoc = disk
    ? { ...disk, matches: [...(disk.matches || [])] }
    : {
        month: ym,
        title: `BlackBerry — тренировочные матчи · ${ym}`,
        note: "Канон plaza (Postgres) + disk",
        matches: [],
      };

  const seen = new Set<string>();
  const merged: Record<string, unknown>[] = [];
  for (const m of base.matches || []) {
    const id = String(m.id || "");
    const c = id ? byId.get(id) : undefined;
    if (c) {
      merged.push(overlayRow(m, trainRowFromCanon(c)));
      seen.add(id);
    } else {
      merged.push(m);
    }
  }
  for (const [id, c] of byId) {
    if (seen.has(id)) continue;
    merged.push(trainRowFromCanon(c));
  }
  merged.sort((a, b) => {
    const da = Number(a.day) || 0;
    const db = Number(b.day) || 0;
    if (da !== db) return da - db;
    return String(a.timeMsk || "").localeCompare(String(b.timeMsk || ""));
  });
  return { ...base, matches: merged };
}

async function mergeCwMonth(
  ym: string,
  disk: MonthDoc | null
): Promise<MonthDoc | null> {
  const [year, month] = ym.split("-").map(Number);
  const rows = await prisma.canonMatch.findMany({
    where: { kind: "CW", year, month },
    orderBy: [{ day: "asc" }, { timeMsk: "asc" }],
  });
  if (!rows.length) return disk;

  const byId = new Map(
    rows.filter((r) => r.legacyId).map((r) => [r.legacyId as string, r])
  );
  const base: MonthDoc = disk
    ? { ...disk, matches: [...(disk.matches || [])] }
    : {
        month: ym,
        title: `КВ — ${ym}`,
        note: "Канон plaza (Postgres) + disk",
        matches: [],
      };

  const seen = new Set<string>();
  const merged: Record<string, unknown>[] = [];
  for (const m of base.matches || []) {
    const id = String(m.id || "");
    const c = id ? byId.get(id) : undefined;
    if (c) {
      merged.push(overlayRow(m, cwRowFromCanon(c)));
      seen.add(id);
    } else {
      merged.push(m);
    }
  }
  for (const [id, c] of byId) {
    if (seen.has(id)) continue;
    merged.push(cwRowFromCanon(c));
  }
  return { ...base, matches: merged };
}

async function trainPlayersDoc(legacyId: string): Promise<object | null> {
  const m = await prisma.canonMatch.findFirst({
    where: { kind: "TRAIN", legacyId },
    include: { players: true },
    orderBy: { updatedAt: "desc" },
  });
  if (!m || !m.players.length) return null;
  const teamA = m.players
    .filter((p) => p.side === "A")
    .map(playerPublic);
  const teamB = m.players
    .filter((p) => p.side === "B")
    .map(playerPublic);
  return {
    matchId: legacyId,
    map: m.mapName,
    mode: m.mode,
    server: m.serverLabel,
    serverKey: m.serverKey,
    winner: m.winner,
    sideA: { name: m.factionA, tickets: m.ticketsA },
    sideB: { name: m.factionB, tickets: m.ticketsB },
    note: m.note,
    source: "canon",
    teamA,
    teamB,
  };
}

async function cwPlayersDoc(legacyId: string): Promise<object | null> {
  const m = await prisma.canonMatch.findFirst({
    where: { kind: "CW", legacyId },
    include: { players: true },
    orderBy: { updatedAt: "desc" },
  });
  if (!m || !m.players.length) return null;
  const pick = (round: number, side: string) =>
    m.players.filter((p) => p.round === round && p.side === side).map(playerPublic);
  // Legacy import used side BB only; opp may be empty — still serve BB sides
  const r1 = pick(1, "BB");
  const r2 = pick(2, "BB");
  const oppR1 = pick(1, "OPP");
  const oppR2 = pick(2, "OPP");
  if (!r1.length && !r2.length) return null;
  return {
    matchId: legacyId,
    opp: m.opp,
    note: m.note,
    source: "canon",
    server: m.serverLabel,
    map: m.mapName,
    r1,
    r2,
    ...(oppR1.length ? { oppR1 } : {}),
    ...(oppR2.length ? { oppR2 } : {}),
  };
}

/**
 * Build / overlay KV JSON for a relative path under kv-cache.
 * `diskData` = already-loaded disk JSON (or null).
 * Returns null if canon has nothing useful (caller keeps disk).
 */
export async function resolveCanonKvJson(
  relPath: string,
  diskData: unknown | null
): Promise<{ data: object; fromCanon: boolean } | null> {
  if (!canonReadEnabled()) return null;
  const rel = relPath.replace(/^\/+/, "");

  try {
    let m = rel.match(TRAIN_MONTH);
    if (m) {
      const [year, month] = m[1].split("-").map(Number);
      const n = await prisma.canonMatch.count({
        where: { kind: "TRAIN", year, month },
      });
      if (!n) return null;
      const out = await mergeTrainMonth(m[1], (diskData as MonthDoc) || null);
      return out ? { data: out, fromCanon: true } : null;
    }
    m = rel.match(CW_MONTH);
    if (m) {
      const [year, month] = m[1].split("-").map(Number);
      const n = await prisma.canonMatch.count({
        where: { kind: "CW", year, month },
      });
      if (!n) return null;
      const out = await mergeCwMonth(m[1], (diskData as MonthDoc) || null);
      return out ? { data: out, fromCanon: true } : null;
    }
    m = rel.match(TRAIN_PLAYERS);
    if (m) {
      const doc = await trainPlayersDoc(m[1]);
      return doc ? { data: doc, fromCanon: true } : null;
    }
    m = rel.match(CW_PLAYERS);
    if (m) {
      const doc = await cwPlayersDoc(m[1]);
      return doc ? { data: doc, fromCanon: true } : null;
    }
  } catch (e) {
    console.warn("[canonMatchRead]", rel, e);
    return null;
  }
  return null;
}
