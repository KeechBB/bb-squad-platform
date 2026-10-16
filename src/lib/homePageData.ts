import { unstable_cache } from "next/cache";
import {
  buildHomeTrainPwrBoard,
  emptyHomeTrainPwrBoard,
} from "@/lib/homeTrainPwr";
import { buildPublicRpLeaderboard } from "@/lib/publicRp";

export type HomePublicTopRow = {
  nick: string;
  rp: number;
  rankLabel: string;
  rankKey: string;
  games: number;
  place: number;
};

/**
 * Только то, что реально рисует главная (два топа).
 * Calendar / tier board — через /api/home-pulse (не блокируют SSR).
 */
export const getHomeDashboardData = unstable_cache(
  async () => {
    const [pwrBoard, publicTop] = await Promise.all([
      buildHomeTrainPwrBoard().catch(() => emptyHomeTrainPwrBoard()),
      buildPublicRpLeaderboard()
        .then((d) =>
          d.rows.slice(0, 10).map((r) => ({
            nick: r.nick,
            rp: r.rp,
            rankLabel: r.rankLabel,
            rankKey: r.rankKey,
            games: r.games || 0,
            place: r.place || 0,
          }))
        )
        .catch(() => [] as HomePublicTopRow[]),
    ]);
    return { pwrBoard, publicTop };
  },
  ["home-dashboard-v14-slim"],
  { revalidate: 120 }
);
