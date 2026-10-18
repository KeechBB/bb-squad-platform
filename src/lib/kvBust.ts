/**
 * Live KV cache-bust for /tm and /cw iframes.
 * Collector / sync_train writes data/cache-bust.json + training-index.bust —
 * so each page load picks a fresh `v=` without redeploying Next.
 */
import { readKvLocalJson } from "@/lib/kvLocal";

type BustFile = { bust?: string; updatedAt?: string };
type TrainIndex = { bust?: string };

/** Fallback only if disk has no bust yet (first boot / empty cache). */
const FALLBACK_BUST = "20261006-train-auto";

export async function liveKvBust(fallback: string = FALLBACK_BUST): Promise<string> {
  const file = await readKvLocalJson<BustFile>("data/cache-bust.json");
  const bustFile = file?.data?.bust;
  if (bustFile && String(bustFile).trim()) return String(bustFile).trim();

  const idx = await readKvLocalJson<TrainIndex>("data/training-index.json");
  const bustIdx = idx?.data?.bust;
  if (bustIdx && String(bustIdx).trim()) return String(bustIdx).trim();

  return fallback;
}
