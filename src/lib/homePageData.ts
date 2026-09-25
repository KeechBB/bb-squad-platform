import { unstable_cache } from "next/cache";
import { buildUpcomingMatchPreviews } from "@/lib/kvForecast";
import { buildHomeMvpBoard, emptyHomeMvpBoard } from "@/lib/homeMvp";
import {
  buildAttendanceStreakBoard,
  emptyAttendanceStreakBoard,
} from "@/lib/attendanceStreaks";
import {
  buildHomeTrainPwrBoard,
  emptyHomeTrainPwrBoard,
} from "@/lib/homeTrainPwr";

/** Общие блоки главной — один параллельный проход, кэш ~45с. */
export const getHomeDashboardData = unstable_cache(
  async () => {
    const [previews, mvpBoard, streakBoard, pwrBoard] = await Promise.all([
      buildUpcomingMatchPreviews(12)
        .then((d) => d.previews)
        .catch(() => [] as Awaited<
          ReturnType<typeof buildUpcomingMatchPreviews>
        >["previews"]),
      buildHomeMvpBoard().catch(() => emptyHomeMvpBoard()),
      buildAttendanceStreakBoard().catch(() => emptyAttendanceStreakBoard()),
      buildHomeTrainPwrBoard().catch(() => emptyHomeTrainPwrBoard()),
    ]);
    return { previews, mvpBoard, streakBoard, pwrBoard };
  },
  ["home-dashboard-v1"],
  { revalidate: 45 }
);
