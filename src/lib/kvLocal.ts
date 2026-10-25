/**
 * Local KV mirror on VPS (synced at deploy into data/kv-cache).
 * Hot paths read disk only — GitHub Pages is not used for live traffic.
 * SERVER ONLY — never import from "use client" components.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  canonReadEnabled,
  isCanonKvRel,
  resolveCanonKvJson,
} from "@/lib/canonMatchRead";

/** Optional emergency remotes (off by default). Set KV_ALLOW_REMOTE=1 to enable. */
export const KV_REMOTE_BASES: string[] = (() => {
  if (process.env.KV_ALLOW_REMOTE !== "1") return [];
  return [
    process.env.KV_DATA_BASE,
    "https://kv.bb-squad.ru",
  ].filter(Boolean) as string[];
})();

/**
 * In-process memo: profile SSR hits the same JSON dozens of times per request.
 * Freshness: invalidate when file mtime changes (always current on disk write).
 * Soft TTL only as safety net if mtime unavailable.
 */
const MEM_TTL_MS = Number(process.env.KV_MEM_TTL_MS || 600_000);
const MEM_SOFT_CAP = Number(process.env.KV_MEM_SOFT_CAP || 2500);
const mem = new Map<
  string,
  { at: number; mtimeMs: number; data: unknown }
>();
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

function memGet<T>(
  rel: string,
  mtimeMs: number
): T | null | undefined {
  const hit = mem.get(rel);
  if (!hit) return undefined;
  if (mtimeMs > 0 && hit.mtimeMs > 0 && hit.mtimeMs !== mtimeMs) {
    mem.delete(rel);
    return undefined;
  }
  if (Date.now() - hit.at > MEM_TTL_MS) {
    mem.delete(rel);
    return undefined;
  }
  return hit.data as T | null;
}

function memSet(rel: string, data: unknown, mtimeMs = 0) {
  mem.set(rel, { at: Date.now(), mtimeMs, data });
  // soft cap — drop oldest chunk if huge
  if (mem.size > MEM_SOFT_CAP) {
    const drop = [...mem.entries()]
      .sort((a, b) => a[1].at - b[1].at)
      .slice(0, Math.floor(MEM_SOFT_CAP / 3));
    for (const [k] of drop) mem.delete(k);
  }
}

/** Read JSON from local KV cache if present. Returns data + mtime for memo. */
export async function readKvLocalJson<T>(
  relPath: string
): Promise<{ data: T; mtimeMs: number } | null> {
  const rel = cleanRel(relPath);
  if (!rel) return null;
  for (const root of kvLocalRoots()) {
    try {
      const full = path.join(root, rel);
      const st = await fs.stat(full);
      const raw = await fs.readFile(full, "utf8");
      return { data: JSON.parse(raw) as T, mtimeMs: st.mtimeMs || 0 };
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
 * Memo: reuse until file mtime changes (always fresh after sync/deploy).
 */
export async function loadKvJsonCached<T>(relPath: string): Promise<T | null> {
  const rel = cleanRel(relPath);
  if (!rel) return null;

  let mtimeMs = 0;
  for (const root of kvLocalRoots()) {
    try {
      const st = await fs.stat(path.join(root, rel));
      mtimeMs = st.mtimeMs || 0;
      break;
    } catch {
      /* next */
    }
  }
  // Canon overlay: invalidate memo every 15s so collector upserts show up.
  if (canonReadEnabled() && isCanonKvRel(rel)) {
    mtimeMs = (mtimeMs || 1) + Math.floor(Date.now() / 15_000);
  }
  const cached = memGet<T>(rel, mtimeMs);
  if (cached !== undefined) return cached;

  const pending = inflight.get(rel);
  if (pending) return pending as Promise<T | null>;

  const job = (async (): Promise<T | null> => {
    try {
      const local = await readKvLocalJson<T>(rel);

      // Phase 3: overlay TRAIN/CW month + players from CanonMatch when present.
      if (canonReadEnabled() && isCanonKvRel(rel)) {
        try {
          const canon = await resolveCanonKvJson(rel, local?.data ?? null);
          if (canon) {
            memSet(rel, canon.data, mtimeMs);
            return canon.data as T;
          }
        } catch {
          /* prisma / canon unavailable — fall through to disk */
        }
      }

      if (local != null) {
        memSet(rel, local.data, local.mtimeMs);
        return local.data;
      }

      for (const base of KV_REMOTE_BASES) {
        try {
          const remote = await fetchRemoteJson<T>(
            `${base.replace(/\/$/, "")}/${rel}`
          );
          memSet(rel, remote, 0);
          return remote;
        } catch {
          /* next */
        }
      }
      memSet(rel, null, mtimeMs);
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
