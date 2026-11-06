import { cache } from "react";
import { buildPlayerKvStats, type PlayerKvStats } from "@/lib/kvStats";
import {
  buildPlayerTrainCombatStats,
  type TrainMatchHistoryRow,
  type PlayerTrainCombatStats,
} from "@/lib/homeTrainPwr";
import { type CwMatchHistoryRow } from "@/lib/homeCwPwr";
import {
  buildPlayerPublicCombatStats,
  type PlayerPublicCombatStats,
} from "@/lib/publicCombat";
import { loadReadyHistories } from "@/lib/profileMatchLines";

export type PlayerProfileHeavy = {
  kvStats: PlayerKvStats | null;
  kvError: string | null;
  trainCombat: PlayerTrainCombatStats | null;
  publicCombat: PlayerPublicCombatStats | null;
  trainHistory: TrainMatchHistoryRow[];
  publicHistory: TrainMatchHistoryRow[];
  cwHistory: CwMatchHistoryRow[];
  trainTotal: number;
  publicTotal: number;
  cwTotal: number;
};

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
      trainTotal: 0,
      publicTotal: 0,
      cwTotal: 0,
    };
  }

  const { collisionBySiteNick } = await import("@/lib/nickCollisions");
  const steamId = collisionBySiteNick(clean)?.steamId || null;
  const [kvBundle, trainCombat, publicCombat, ready] = await Promise.all([
    buildPlayerKvStats(clean)
      .then((stats) => ({ stats, error: null as string | null }))
      .catch(() => ({
        stats: null as PlayerKvStats | null,
        error: "Не удалось загрузить стату КВ" as string | null,
      })),
    buildPlayerTrainCombatStats(clean, { steamId }).catch(() => null),
    buildPlayerPublicCombatStats(clean).catch(() => null),
    loadReadyHistories(clean).catch(() => null),
  ]);

  return {
    kvStats: kvBundle.stats,
    kvError: kvBundle.error,
    trainCombat,
    publicCombat,
    trainHistory: (ready?.trainHistory || []) as TrainMatchHistoryRow[],
    publicHistory: (ready?.publicHistory || []) as TrainMatchHistoryRow[],
    cwHistory: (ready?.cwHistory || []) as CwMatchHistoryRow[],
    trainTotal: ready?.trainTotal || 0,
    publicTotal: ready?.publicTotal || 0,
    cwTotal: ready?.cwTotal || 0,
  };
}

/**
 * Тяжёлая стата профиля.
 * `cache()` — только внутри Next-запроса; cron/tsx без incrementalCache
 * иначе падает и тёплый снимок пишет trainCombat:null (пустая «Статистика тренировок»).
 */
const loadPlayerProfileHeavyCached = cache(loadPlayerProfileHeavyUncached);

export async function loadPlayerProfileHeavy(
  nick: string
): Promise<PlayerProfileHeavy> {
  try {
    return await loadPlayerProfileHeavyCached(nick);
  } catch {
    return loadPlayerProfileHeavyUncached(nick);
  }
}

export type PlayerProfileStats = {
  kvStats: PlayerKvStats | null;
  kvError: string | null;
  trainCombat: PlayerTrainCombatStats | null;
  publicCombat: PlayerPublicCombatStats | null;
};

export type PlayerProfileHistories = {
  trainHistory: TrainMatchHistoryRow[];
  publicHistory: TrainMatchHistoryRow[];
  cwHistory: CwMatchHistoryRow[];
  trainTotal?: number;
  publicTotal?: number;
  cwTotal?: number;
};

/** Вкладки статы профиля (КВ / train / public combat). */
export async function loadPlayerProfileStats(
  nick: string
): Promise<PlayerProfileStats> {
  const h = await loadPlayerProfileHeavy(nick);
  return {
    kvStats: h.kvStats,
    kvError: h.kvError,
    trainCombat: h.trainCombat,
    publicCombat: h.publicCombat,
  };
}

/** Истории матчей профиля (train / public / CW). */
export async function loadPlayerProfileHistories(
  nick: string
): Promise<PlayerProfileHistories> {
  const h = await loadPlayerProfileHeavy(nick);
  return {
    trainHistory: h.trainHistory,
    publicHistory: h.publicHistory,
    cwHistory: h.cwHistory,
    trainTotal: h.trainTotal,
    publicTotal: h.publicTotal,
    cwTotal: h.cwTotal,
  };
}
