import { unstable_cache } from "next/cache";
import { buildCalendarMatches } from "@/lib/kvForecast";
import {
  buildHomeTrainPwrBoard,
  emptyHomeTrainPwrBoard,
} from "@/lib/homeTrainPwr";
import { buildHomeTierBoard, emptyHomeTierBoard } from "@/lib/homeTierBoard";

/** Общие блоки главной — один параллельный проход, кэш ~2 мин. */
export const getHomeDashboardData = unstable_cache(
  async () => {
    const [previews, pwrBoard, tierBoard] = await Promise.all([
      buildCalendarMatches()
        .then((d) => d.previews)
        .catch(() => [] as Awaited<ReturnType<typeof buildCalendarMatches>>["previews"]),
      buildHomeTrainPwrBoard().catch(() => emptyHomeTrainPwrBoard()),
      buildHomeTierBoard().catch(() => emptyHomeTierBoard()),
    ]);
    return { previews, pwrBoard, tierBoard };
  },
  ["home-dashboard-v12-calendar"],
  { revalidate: 120 }
);
