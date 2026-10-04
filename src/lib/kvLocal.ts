/**
 * Local KV mirror on VPS (synced at deploy into data/kv-cache).
 * Hot paths read disk only — GitHub Pages is not used for live traffic.
 */
import { promises as fs } from "fs";
import path from "path";

/** Optional emergency remotes (off by default). Set KV_ALLOW_REMOTE=1 to enable. */
export const KV_REMOTE_BASES: string[] = (() => {
  if (process.env.KV_ALLOW_REMOTE !== "1") return [];
  return [
    process.env.KV_DATA_BASE,
    "https://kv.bb-squad.ru",
  ].filter(Boolean) as string[];
})();

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
 */
export async function loadKvJsonCached<T>(relPath: string): Promise<T | null> {
  const rel = cleanRel(relPath);
  if (!rel) return null;

  const local = await readKvLocalJson<T>(rel);
  if (local != null) return local;

  for (const base of KV_REMOTE_BASES) {
    try {
      return await fetchRemoteJson<T>(`${base.replace(/\/$/, "")}/${rel}`);
    } catch {
      /* next */
    }
  }
  return null;
}
