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
  nickPatch?: string | null;
  nickStyle?: string | null;
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
      (async () => {
        try {
          const { loadNickPatchByNick } = await import("@/lib/nickPatchesCache");
          const [board, cosmetics] = await Promise.all([
            buildPublicRpLeaderboard(),
            loadNickPatchByNick().catch(() => new Map()),
          ]);
          return board.rows.slice(0, 10).map((r) => {
            const cos = cosmetics.get(
              String(r.nick || "").trim().toLowerCase()
            );
            return {
              nick: r.nick,
              rp: r.rp,
              rankLabel: r.rankLabel,
              rankKey: r.rankKey,
              nickPatch: cos?.patchId || null,
              nickStyle: cos?.styleId || null,
            };
          }) as HomePublicTopRow[];
        } catch {
          return [] as HomePublicTopRow[];
        }
      })(),
    ]);
    return { previews, pwrBoard, tierBoard, publicTop };
  },
  ["home-dashboard-v14-nick-cosmetics"],
  { revalidate: 120 }
);
