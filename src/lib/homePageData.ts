import { unstable_cache } from "next/cache";
import { buildCalendarMatches } from "@/lib/kvForecast";
import {
  buildHomeTrainPwrBoard,
  emptyHomeTrainPwrBoard,
} from "@/lib/homeTrainPwr";
import { buildHomeTierBoard, emptyHomeTierBoard } from "@/lib/homeTierBoard";
import { buildPublicRpLeaderboard } from "@/lib/publicRp";

export type HomePublicTopRow = {
  nick: string;
  rp: number;
  rankLabel: string;
  rankKey: string;
};

/** Общие блоки главной — один параллельный проход, кэш ~2 мин. */
export const getHomeDashboardData = unstable_cache(
  async () => {
    const [previews, pwrBoard, tierBoard, publicTop] = await Promise.all([
      buildCalendarMatches()
        .then((d) => d.previews)
        .catch(() => [] as Awaited<ReturnType<typeof buildCalendarMatches>>["previews"]),
      buildHomeTrainPwrBoard().catch(() => emptyHomeTrainPwrBoard()),
      buildHomeTierBoard().catch(() => emptyHomeTierBoard()),
      buildPublicRpLeaderboard()
        .then((d) =>
          d.rows.slice(0, 10).map((r) => ({
            nick: r.nick,
            rp: r.rp,
            rankLabel: r.rankLabel,
            rankKey: r.rankKey,
          }))
        )
        .catch(() => [] as HomePublicTopRow[]),
    ]);
    return { previews, pwrBoard, tierBoard, publicTop };
  },
  ["home-dashboard-v13-panels"],
  { revalidate: 120 }
);
