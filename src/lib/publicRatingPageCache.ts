/**
 * Shared cache for /public SSR payload across PM2 cluster workers.
 *
 * Problem: buildPublicRatingTable + listPublicMatches are heavy; under concurrent
 * hits each of 4 workers stampedes unstable_cache and rebuilds for ~10–18s.
 *
 * Fix: one JSON snapshot on disk + per-process memo + single-flight rebuild.
 * Stale-while-revalidate: serve snapshot up to 10 min old while refreshing.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { PublicCombatRow } from "@/lib/publicCombat";
import type { PublicMatchRow } from "@/lib/publicMatches";
import {
  loadPublicRpTopFromDb,
  loadPublicRpUpdatedAt,
} from "@/lib/rpDbRead";

export type PublicRatingPagePayload = {
  board: {
    rows: PublicCombatRow[];
    matches: number;
    updatedAt: string;
  };
  matchHistory: PublicMatchRow[];
  builtAt: string;
};

const FRESH_MS = Number(process.env.PUBLIC_RATING_CACHE_FRESH_MS || 90_000);
const STALE_MS = Number(process.env.PUBLIC_RATING_CACHE_STALE_MS || 600_000);

function cachePath(): string {
  return (
    process.env.PUBLIC_RATING_CACHE_PATH ||
    path.join(process.cwd(), "data", "cache", "public-rating-page.json")
  );
}

let mem: { at: number; data: PublicRatingPagePayload } | null = null;
let inflight: Promise<PublicRatingPagePayload> | null = null;

async function readDisk(): Promise<PublicRatingPagePayload | null> {
  try {
    const raw = await fs.readFile(cachePath(), "utf8");
    const data = JSON.parse(raw) as PublicRatingPagePayload;
    if (!data?.board?.rows || !Array.isArray(data.matchHistory) || !data.builtAt) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

async function writeDisk(data: PublicRatingPagePayload): Promise<void> {
  const file = cachePath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data), "utf8");
  await fs.rename(tmp, file);
}

function generationPath(): string {
  return path.join(process.cwd(), "data", "cache", "public-rating-generation");
}

/** Scorer writes this when a match is published. Newer than builtAt means the snapshot is stale. */
async function publishedNewerThan(data: PublicRatingPagePayload): Promise<boolean> {
  try {
    const raw = await fs.readFile(generationPath(), "utf8");
    const published = Date.parse(raw.trim());
    const built = Date.parse(data.builtAt);
    return Number.isFinite(published) && Number.isFinite(built) && published > built;
  } catch {
    return false;
  }
}

function ageMs(data: PublicRatingPagePayload): number {
  const t = Date.parse(data.builtAt);
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  return Date.now() - t;
}

async function rebuild(): Promise<PublicRatingPagePayload> {
  const { buildPublicRatingTable } = await import("@/lib/publicCombat");
  const { listPublicMatches } = await import("@/lib/publicMatches");
  const [board, matchHistory] = await Promise.all([
    buildPublicRatingTable(500),
    listPublicMatches(400),
  ]);
  const data: PublicRatingPagePayload = {
    board,
    matchHistory,
    builtAt: new Date().toISOString(),
  };
  mem = { at: Date.now(), data };
  try {
    await writeDisk(data);
  } catch (e) {
    console.warn("[publicRatingPageCache] writeDisk failed", e);
  }
  return data;
}

function kickRefresh(): void {
  if (inflight) return;
  inflight = rebuild().finally(() => {
    inflight = null;
  });
}

function nickKey(n: string): string {
  return String(n || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

/**
 * Combat rows stay cached. The RP number is replaced from the database ladder
 * and the table is ordered again, so /public matches home and the profile.
 */
async function withLiveRp(
  data: PublicRatingPagePayload
): Promise<PublicRatingPagePayload> {
  try {
    // Light board only — never loadPublicRpLadder() (13k × matchesJson OOMs → HTTP 500).
    // Static import: dynamic chunk for rpDbRead had broken named exports after deploy.
    const need = Math.max(500, data.board.rows.length || 0);
    const board = await loadPublicRpTopFromDb(need);
    if (!board.length) return data;
    const stamp = await loadPublicRpUpdatedAt();
    const byNick = new Map(board.map((r) => [nickKey(r.nick), r]));
    const rows = data.board.rows.map((row) => {
      const live = byNick.get(nickKey(row.nick));
      if (!live) return row;
      return {
        ...row,
        rp: live.rp,
        rankLabel: live.predatorPlace
          ? `PREDATOR #${live.predatorPlace}`
          : live.rankLabel,
        rankKey: live.predatorPlace ? "predator" : live.rankKey,
        predatorPlace: live.predatorPlace ?? null,
      };
    });
    rows.sort((a, b) => {
      const ar = a.rp == null ? -1e9 : a.rp;
      const br = b.rp == null ? -1e9 : b.rp;
      if (ar !== br) return br - ar;
      const am = a.mvpMedic + a.mvpKiller + a.mvpArmor;
      const bm = b.mvpMedic + b.mvpKiller + b.mvpArmor;
      if (bm !== am) return bm - am;
      if (b.days !== a.days) return b.days - a.days;
      return a.nick.localeCompare(b.nick, "ru");
    });
    rows.forEach((r, i) => {
      r.place = i + 1;
    });
    return {
      ...data,
      board: {
        ...data.board,
        rows,
        updatedAt: stamp || data.board.updatedAt,
      },
    };
  } catch (e) {
    console.warn("[publicRatingPageCache] live rp overlay failed", e);
    return data;
  }
}

/** Оформление ника живёт отдельно от combat-кэша — всегда подмешиваем из БД. */
async function withLiveNickPatches(
  data: PublicRatingPagePayload
): Promise<PublicRatingPagePayload> {
  data = await withLiveRp(data);
  try {
    const { loadNickPatchBySteam } = await import("@/lib/nickPatchesCache");
    const map = await loadNickPatchBySteam();
    const rows = data.board.rows.map((r) => ({
      ...r,
      nickPatch: r.steamId ? map.get(r.steamId)?.patchId || null : null,
      nickStyle: r.steamId ? map.get(r.steamId)?.styleId || null : null,
    }));
    return { ...data, board: { ...data.board, rows } };
  } catch (e) {
    console.warn("[publicRatingPageCache] nick customization overlay failed", e);
    return data;
  }
}

/**
 * Fast path for /public. Prefer fresh mem/disk; serve stale while refreshing;
 * only block on cold miss.
 */
export async function getPublicRatingPagePayload(opts?: {
  force?: boolean;
}): Promise<PublicRatingPagePayload> {
  if (opts?.force) {
    if (inflight) return withLiveNickPatches(await inflight);
    inflight = rebuild().finally(() => {
      inflight = null;
    });
    return withLiveNickPatches(await inflight);
  }

  if (
    mem &&
    Date.now() - mem.at < FRESH_MS &&
    ageMs(mem.data) < FRESH_MS &&
    !(await publishedNewerThan(mem.data))
  ) {
    return withLiveNickPatches(mem.data);
  }

  const disk = await readDisk();
  if (disk && !(await publishedNewerThan(disk))) {
    const age = ageMs(disk);
    if (age < FRESH_MS) {
      mem = { at: Date.now(), data: disk };
      return withLiveNickPatches(disk);
    }
    if (age < STALE_MS) {
      mem = { at: Date.now(), data: disk };
      kickRefresh();
      return withLiveNickPatches(disk);
    }
  }

  if (inflight) return withLiveNickPatches(await inflight);
  inflight = rebuild().finally(() => {
    inflight = null;
  });
  return withLiveNickPatches(await inflight);
}
