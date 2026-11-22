/**
 * Disk + memory cache for clan PB1 stats.
 * Click should read a ready snapshot; rebuild runs on join / PB1 match / stale.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { ClanPublicStats } from "@/lib/clanPublicStats";
import { prisma } from "@/lib/prisma";

export type ClanPublicStatsSnapshot = {
  clanId: string;
  tag: string;
  builtAt: string;
  public: ClanPublicStats;
};

const FRESH_MS = Number(process.env.CLAN_PUBLIC_STATS_FRESH_MS || 120_000);
const STALE_MS = Number(process.env.CLAN_PUBLIC_STATS_STALE_MS || 900_000);

const mem = new Map<string, { at: number; data: ClanPublicStatsSnapshot }>();
const inflight = new Map<string, Promise<ClanPublicStatsSnapshot>>();

function cacheDir(): string {
  return (
    process.env.CLAN_PUBLIC_STATS_CACHE_DIR ||
    path.join(process.cwd(), "data", "cache", "clan-public-stats")
  );
}

function cacheFile(clanId: string): string {
  return path.join(cacheDir(), `${clanId}.json`);
}

function publicGenPath(): string {
  return path.join(process.cwd(), "data", "cache", "public-rating-generation");
}

async function readDisk(clanId: string): Promise<ClanPublicStatsSnapshot | null> {
  try {
    const raw = await fs.readFile(cacheFile(clanId), "utf8");
    const data = JSON.parse(raw) as ClanPublicStatsSnapshot;
    if (!data?.public || !data.builtAt || data.clanId !== clanId) return null;
    return data;
  } catch {
    return null;
  }
}

async function writeDisk(data: ClanPublicStatsSnapshot): Promise<void> {
  const file = cacheFile(data.clanId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data), "utf8");
  await fs.rename(tmp, file);
}

function ageMs(data: ClanPublicStatsSnapshot): number {
  const t = Date.parse(data.builtAt);
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  return Date.now() - t;
}

async function publicNewerThan(data: ClanPublicStatsSnapshot): Promise<boolean> {
  try {
    const raw = await fs.readFile(publicGenPath(), "utf8");
    const published = Date.parse(raw.trim());
    const built = Date.parse(data.builtAt);
    return Number.isFinite(published) && Number.isFinite(built) && published > built;
  } catch {
    return false;
  }
}

async function rebuildOne(
  clanId: string,
  tag?: string
): Promise<ClanPublicStatsSnapshot> {
  const clan =
    tag != null
      ? { id: clanId, tag }
      : await prisma.clan.findUnique({
          where: { id: clanId },
          select: { id: true, tag: true },
        });
  if (!clan) throw new Error("clan not found");

  const { buildClanPublicStats } = await import("@/lib/clanPublicStats");
  const publicStats = await buildClanPublicStats({
    clanId: clan.id,
    tag: clan.tag,
  });
  const snap: ClanPublicStatsSnapshot = {
    clanId: clan.id,
    tag: clan.tag,
    builtAt: new Date().toISOString(),
    public: publicStats,
  };
  mem.set(clanId, { at: Date.now(), data: snap });
  try {
    await writeDisk(snap);
  } catch (e) {
    console.warn("[clanPublicStatsCache] writeDisk", clanId, e);
  }
  return snap;
}

function kickRebuild(clanId: string, tag?: string): void {
  if (inflight.has(clanId)) return;
  const job = rebuildOne(clanId, tag).finally(() => inflight.delete(clanId));
  inflight.set(clanId, job);
}

/**
 * Instant path: return disk/mem snapshot if present.
 * Rebuild in background when stale / public ladder bumped.
 * Only blocks when no snapshot exists yet.
 */
export async function getClanPublicStatsCached(
  clanId: string,
  tag: string
): Promise<ClanPublicStatsSnapshot> {
  const hit = mem.get(clanId)?.data || (await readDisk(clanId));
  if (hit) {
    mem.set(clanId, { at: Date.now(), data: hit });
    const age = ageMs(hit);
    const genNewer = await publicNewerThan(hit);
    if (age > FRESH_MS || genNewer) {
      kickRebuild(clanId, tag);
    }
    if (age <= STALE_MS || !genNewer) {
      return hit;
    }
    // very stale + gen bump: wait for rebuild once
    const waiting = inflight.get(clanId);
    if (waiting) return waiting;
    return rebuildOne(clanId, tag);
  }

  const waiting = inflight.get(clanId);
  if (waiting) return waiting;
  return rebuildOne(clanId, tag);
}

/** After clan roster change — rebuild this clan in background. */
export function invalidateClanPublicStats(
  clanId: string,
  tag?: string
): void {
  mem.delete(clanId);
  kickRebuild(clanId, tag);
}

/** After PB1 match / ladder publish — refresh all real clans (background). */
export async function invalidateAllClanPublicStats(): Promise<void> {
  try {
    await fs.mkdir(path.dirname(publicGenPath()), { recursive: true });
    await fs.writeFile(publicGenPath(), new Date().toISOString(), "utf8");
  } catch {
    /* ignore */
  }
  const clans = await prisma.clan.findMany({
    where: { isExternal: false },
    select: { id: true, tag: true },
  });
  for (const c of clans) {
    mem.delete(c.id);
    kickRebuild(c.id, c.tag);
  }
}

/** Warm cache for one clan (await). Used by warm script / first deploy. */
export async function warmClanPublicStats(
  clanId: string,
  tag?: string
): Promise<ClanPublicStatsSnapshot> {
  return rebuildOne(clanId, tag);
}
