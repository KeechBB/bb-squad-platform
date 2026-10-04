/**
 * Server-only: read tiers.json from VPS kv-cache.
 * Client components must import helpers from `@/lib/tiers` only.
 */
import { buildTierIndex } from "@/lib/tiers";

export async function loadTierIndex(): Promise<Map<string, 1 | 2 | 3>> {
  try {
    const { loadKvJsonCached } = await import("@/lib/kvLocal");
    const data = await loadKvJsonCached<{
      tier1?: string[];
      tier2?: string[];
      tier3?: string[];
      aliases?: Record<string, string>;
    }>("data/tiers.json");
    return buildTierIndex(data);
  } catch {
    return new Map();
  }
}
