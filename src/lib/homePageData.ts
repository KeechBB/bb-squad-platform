import { unstable_cache } from "next/cache";
import { buildUpcomingMatchPreviews } from "@/lib/kvForecast";
import { buildHomeMvpBoard, emptyHomeMvpBoard } from "@/lib/homeMvp";
import {
  buildHomeTrainPwrBoard,
  emptyHomeTrainPwrBoard,
} from "@/lib/homeTrainPwr";
import {
  buildHomeCwPwrBoard,
  emptyHomeCwPwrBoard,
} from "@/lib/homeCwPwr";

/** Общие блоки главной — один параллельный проход, кэш ~45с. */
export const getHomeDashboardData = unstable_cache(
  async () => {
    const [previews, mvpBoard, pwrBoard, cwPwrBoard] = await Promise.all([
      buildUpcomingMatchPreviews(12)
        .then((d) => d.previews)
        .catch(() => [] as Awaited<
          ReturnType<typeof buildUpcomingMatchPreviews>
        >["previews"]),
      buildHomeMvpBoard().catch(() => emptyHomeMvpBoard()),
      buildHomeTrainPwrBoard().catch(() => emptyHomeTrainPwrBoard()),
      buildHomeCwPwrBoard().catch(() => emptyHomeCwPwrBoard()),
    ]);
    return { previews, mvpBoard, pwrBoard, cwPwrBoard };
  },
  ["home-dashboard-v3"],
  { revalidate: 45 }
);
