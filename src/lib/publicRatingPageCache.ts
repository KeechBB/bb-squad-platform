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

/**
 * Fast path for /public. Prefer fresh mem/disk; serve stale while refreshing;
 * only block on cold miss.
 */
export async function getPublicRatingPagePayload(opts?: {
  force?: boolean;
}): Promise<PublicRatingPagePayload> {
  if (opts?.force) {
    if (inflight) return inflight;
    inflight = rebuild().finally(() => {
      inflight = null;
    });
    return inflight;
  }

  if (mem && Date.now() - mem.at < FRESH_MS && ageMs(mem.data) < FRESH_MS) {
    return mem.data;
  }

  const disk = await readDisk();
  if (disk) {
    const age = ageMs(disk);
    if (age < FRESH_MS) {
      mem = { at: Date.now(), data: disk };
      return disk;
    }
    if (age < STALE_MS) {
      mem = { at: Date.now(), data: disk };
      kickRefresh();
      return disk;
    }
  }

  if (inflight) return inflight;
  inflight = rebuild().finally(() => {
    inflight = null;
  });
  return inflight;
}
