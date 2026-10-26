import { unstable_cache } from "next/cache";
import { buildCalendarMatches } from "@/lib/kvForecast";
import {
  emptyHomeTrainPwrBoard,
  type HomeTrainPwrBoard,
} from "@/lib/homeTrainPwr";
import { buildHomeTierBoard, emptyHomeTierBoard } from "@/lib/homeTierBoard";
import { buildPublicRpLeaderboard } from "@/lib/publicRp";
import type { NickPatchPublicRow } from "@/lib/nickPatchesCache";

export type HomePublicTopRow = {
  nick: string;
  rp: number;
  rankLabel: string;
  rankKey: string;
  nickPatch?: string | null;
  nickStyle?: string | null;
};

type HomeDashboardCached = {
  previews: Awaited<ReturnType<typeof buildCalendarMatches>>["previews"];
  pwrBoard: HomeTrainPwrBoard;
  tierBoard: Awaited<ReturnType<typeof buildHomeTierBoard>>;
  publicTop: HomePublicTopRow[];
};

function nickKey(nick: string | null | undefined): string {
  return String(nick || "")
    .trim()
    .toLowerCase();
}

function applyLiveNickCosmetics<T extends { nick: string; nickPatch?: string | null; nickStyle?: string | null }>(
  rows: T[],
  cosmetics: Map<string, NickPatchPublicRow>
): T[] {
  if (!cosmetics.size) return rows;
  return rows.map((r) => {
    const cos = cosmetics.get(nickKey(r.nick));
    if (!cos) return { ...r, nickPatch: null, nickStyle: null };
    return {
      ...r,
      nickPatch: cos.patchId || null,
      nickStyle: cos.styleId || null,
    };
  });
}

/** Тяжёлые блоки главной — кэш ~2 мин; стили ника подмешиваем live из БД. */
const getHomeDashboardCached = unstable_cache(
  async (): Promise<HomeDashboardCached> => {
    const [previews, pwrBoard, tierBoard, publicTop] = await Promise.all([
      buildCalendarMatches()
        .then((d) => d.previews)
        .catch(
          () =>
            [] as Awaited<
              ReturnType<typeof buildCalendarMatches>
            >["previews"]
        ),
      Promise.resolve(emptyHomeTrainPwrBoard()),
      buildHomeTierBoard().catch(() => emptyHomeTierBoard()),
      (async () => {
        try {
          const board = await buildPublicRpLeaderboard();
          return board.rows.slice(0, 10).map((r) => ({
            nick: r.nick,
            rp: r.rp,
            rankLabel: r.rankLabel,
            rankKey: r.rankKey,
            nickPatch: null as string | null,
            nickStyle: null as string | null,
          })) as HomePublicTopRow[];
        } catch {
          return [] as HomePublicTopRow[];
        }
      })(),
    ]);
    return { previews, pwrBoard, tierBoard, publicTop };
  },
  ["home-dashboard-v15-nick-cosmetics-live"],
  { revalidate: 120 }
);

export async function getHomeDashboardData(): Promise<HomeDashboardCached> {
  const data = await getHomeDashboardCached();
  try {
    const { loadNickPatchByNick } = await import("@/lib/nickPatchesCache");
    const cosmetics = await loadNickPatchByNick();
    return {
      ...data,
      publicTop: applyLiveNickCosmetics(data.publicTop, cosmetics),
      pwrBoard: {
        ...data.pwrBoard,
        top10: applyLiveNickCosmetics(data.pwrBoard.top10, cosmetics),
      },
    };
  } catch {
    return data;
  }
}
