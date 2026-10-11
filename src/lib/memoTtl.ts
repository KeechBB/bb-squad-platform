/**
 * In-process TTL memo for one Node server (PM2).
 * Holds a derived snapshot only — callers must not mutate the value.
 * A failed load is not kept, so the next request tries again.
 */

const globalMemo = globalThis as unknown as {
  __bbMemoTtl?: Map<string, { at: number; pending: Promise<unknown> }>;
};

function store() {
  if (!globalMemo.__bbMemoTtl) globalMemo.__bbMemoTtl = new Map();
  return globalMemo.__bbMemoTtl;
}

export function memoTtl<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>
): Promise<T> {
  const box = store();
  const now = Date.now();
  const hit = box.get(key) as { at: number; pending: Promise<T> } | undefined;
  if (hit && now - hit.at < ttlMs) return hit.pending;

  const pending = loader().catch((err: unknown) => {
    const cur = box.get(key);
    if (cur?.pending === pending) box.delete(key);
    throw err;
  });
  box.set(key, { at: now, pending });
  return pending;
}

/** Сколько держим общий срез матчей для профилей. */
export const PROFILE_CORPUS_TTL_MS = 120_000;
