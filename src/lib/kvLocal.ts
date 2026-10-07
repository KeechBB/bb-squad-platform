/**
 * Local KV mirror on VPS (synced at deploy into data/kv-cache).
 * Hot paths read disk only — GitHub Pages is not used for live traffic.
 * SERVER ONLY — never import from "use client" components.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

/** Optional emergency remotes (off by default). Set KV_ALLOW_REMOTE=1 to enable. */
export const KV_REMOTE_BASES: string[] = (() => {
  if (process.env.KV_ALLOW_REMOTE !== "1") return [];
  return [
    process.env.KV_DATA_BASE,
    "https://kv.bb-squad.ru",
  ].filter(Boolean) as string[];
})();

/** In-process memo: profile SSR hits the same JSON dozens of times per request. */
const MEM_TTL_MS = Number(process.env.KV_MEM_TTL_MS || 120_000);
const MEM_SOFT_CAP = Number(process.env.KV_MEM_SOFT_CAP || 1200);
const mem = new Map<string, { at: number; data: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

/** Directories checked before remote fetch (first hit wins). */
export function kvLocalRoots(): string[] {
  const roots = [
    process.env.KV_LOCAL_DIR,
    path.join(process.cwd(), "data", "kv-cache"),
  ].filter(Boolean) as string[];
  return roots;
}

function cleanRel(relPath: string): string {
  return String(relPath || "")
    .replace(/^\/+/, "")
    .replace(/\.\./g, "");
}

function memGet<T>(rel: string): T | null | undefined {
  const hit = mem.get(rel);
  if (!hit) return undefined;
  if (Date.now() - hit.at > MEM_TTL_MS) {
    mem.delete(rel);
    return undefined;
  }
  return hit.data as T | null;
}

function memSet(rel: string, data: unknown) {
  mem.set(rel, { at: Date.now(), data });
  // soft cap — drop oldest chunk if huge
  if (mem.size > MEM_SOFT_CAP) {
    const drop = [...mem.entries()]
      .sort((a, b) => a[1].at - b[1].at)
      .slice(0, Math.floor(MEM_SOFT_CAP / 3));
    for (const [k] of drop) mem.delete(k);
  }
}

/** Read JSON from local KV cache if present. */
export async function readKvLocalJson<T>(relPath: string): Promise<T | null> {
  const rel = cleanRel(relPath);
  if (!rel) return null;
  for (const root of kvLocalRoots()) {
    try {
      const full = path.join(root, rel);
      const raw = await fs.readFile(full, "utf8");
      return JSON.parse(raw) as T;
    } catch {
      /* next root */
    }
  }
  return null;
}

async function fetchRemoteJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { next: { revalidate: 90 } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

/**
 * Load KV JSON: local disk first; remote only if KV_ALLOW_REMOTE=1.
 * `relPath` like `data/training/rp-ladder.json`.
 * Memoized ~45s in-process (+ coalesced in-flight).
 */
export async function loadKvJsonCached<T>(relPath: string): Promise<T | null> {
  const rel = cleanRel(relPath);
  if (!rel) return null;

  const cached = memGet<T>(rel);
  if (cached !== undefined) return cached;

  const pending = inflight.get(rel);
  if (pending) return pending as Promise<T | null>;

  const job = (async (): Promise<T | null> => {
    try {
      const local = await readKvLocalJson<T>(rel);
      if (local != null) {
        memSet(rel, local);
        return local;
      }

      for (const base of KV_REMOTE_BASES) {
        try {
          const remote = await fetchRemoteJson<T>(
            `${base.replace(/\/$/, "")}/${rel}`
          );
          memSet(rel, remote);
          return remote;
        } catch {
          /* next */
        }
      }
      memSet(rel, null);
      return null;
    } finally {
      inflight.delete(rel);
    }
  })();

  inflight.set(rel, job);
  return job;
}

/** Drop memo (tests / after heavy KV write). */
export function clearKvMemCache() {
  mem.clear();
  inflight.clear();
}
