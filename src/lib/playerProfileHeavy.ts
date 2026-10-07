import { cache } from "react";
import { unstable_cache } from "next/cache";
import { buildPlayerKvStats, type PlayerKvStats } from "@/lib/kvStats";
import {
  buildPlayerTrainMatchHistory,
  buildPlayerTrainCombatStats,
  type TrainMatchHistoryRow,
  type PlayerTrainCombatStats,
} from "@/lib/homeTrainPwr";
import {
  buildPlayerCwMatchHistory,
  type CwMatchHistoryRow,
} from "@/lib/homeCwPwr";
import { buildPlayerPublicMatchHistory } from "@/lib/publicMatchHistory";
import {
  buildPlayerPublicCombatStats,
  type PlayerPublicCombatStats,
} from "@/lib/publicCombat";

export type PlayerProfileHeavy = {
  kvStats: PlayerKvStats | null;
  kvError: string | null;
  trainCombat: PlayerTrainCombatStats | null;
  publicCombat: PlayerPublicCombatStats | null;
  trainHistory: TrainMatchHistoryRow[];
  publicHistory: TrainMatchHistoryRow[];
  cwHistory: CwMatchHistoryRow[];
};

function nickCacheKey(nick: string) {
  return String(nick || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

async function loadPlayerProfileHeavyUncached(
  nick: string
): Promise<PlayerProfileHeavy> {
  const clean = String(nick || "").trim();
  if (!clean) {
    return {
      kvStats: null,
      kvError: null,
      trainCombat: null,
      publicCombat: null,
      trainHistory: [],
      publicHistory: [],
      cwHistory: [],
    };
  }

  const [
    kvBundle,
    trainCombat,
    publicCombat,
    trainHistory,
    publicHistory,
    cwHistory,
  ] = await Promise.all([
    buildPlayerKvStats(clean)
      .then((stats) => ({ stats, error: null as string | null }))
      .catch(() => ({
        stats: null as PlayerKvStats | null,
        error: "Не удалось загрузить стату КВ" as string | null,
      })),
    buildPlayerTrainCombatStats(clean).catch(() => null),
    buildPlayerPublicCombatStats(clean).catch(() => null),
    buildPlayerTrainMatchHistory(clean).catch(() => []),
    buildPlayerPublicMatchHistory(clean).catch(() => []),
    buildPlayerCwMatchHistory(clean).catch(() => []),
  ]);

  return {
    kvStats: kvBundle.stats,
    kvError: kvBundle.error,
    trainCombat,
    publicCombat,
    trainHistory,
    publicHistory,
    cwHistory,
  };
}

/** Тяжёлая стата профиля — dedupe в запросе + кэш 90с между запросами. */
export const loadPlayerProfileHeavy = cache(
  async (nick: string): Promise<PlayerProfileHeavy> => {
    const key = nickCacheKey(nick);
    if (!key) return loadPlayerProfileHeavyUncached(nick);
    const cached = unstable_cache(
      () => loadPlayerProfileHeavyUncached(nick),
      ["profile-heavy-v1", key],
      { revalidate: 90 }
    );
    return cached();
  }
);
