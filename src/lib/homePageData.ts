import { unstable_cache } from "next/cache";
import { buildUpcomingMatchPreviews } from "@/lib/kvForecast";
import { buildHomeMvpBoard, emptyHomeMvpBoard } from "@/lib/homeMvp";
import {
  buildHomeTrainPwrBoard,
  emptyHomeTrainPwrBoard,
} from "@/lib/homeTrainPwr";
import { buildHomeTierBoard, emptyHomeTierBoard } from "@/lib/homeTierBoard";

/** Общие блоки главной — один параллельный проход, кэш ~45с. */
export const getHomeDashboardData = unstable_cache(
  async () => {
    const [previews, mvpBoard, pwrBoard, tierBoard] = await Promise.all([
      buildUpcomingMatchPreviews(12)
        .then((d) => d.previews)
        .catch(() => [] as Awaited<
          ReturnType<typeof buildUpcomingMatchPreviews>
        >["previews"]),
      buildHomeMvpBoard().catch(() => emptyHomeMvpBoard()),
      buildHomeTrainPwrBoard().catch(() => emptyHomeTrainPwrBoard()),
      buildHomeTierBoard().catch(() => emptyHomeTierBoard()),
    ]);
    return { previews, mvpBoard, pwrBoard, tierBoard };
  },
  ["home-dashboard-v6-cancel-sec106"],
  { revalidate: 45 }
);
