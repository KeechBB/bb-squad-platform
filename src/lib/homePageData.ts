import { snapshotOrBuild } from "@/lib/diskSnapshot";
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

/** Тяжёлые блоки главной. Файл общий для всех воркеров; стили ника подмешиваем отдельно. */
async function buildHomeDashboard(): Promise<HomeDashboardCached> {
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
      livePublicTop(),
    ]);
    return { previews, pwrBoard, tierBoard, publicTop };
}

async function livePublicTopFromFile(): Promise<HomePublicTopRow[]> {
  try {
    const { readFile } = await import("fs/promises");
    const { join } = await import("path");
    const raw = await readFile(
      join(process.cwd(), "data", "public", "rp-ladder.json"),
      "utf8"
    );
    const lad = JSON.parse(raw) as {
      leaderboard?: Array<{
        nick?: string;
        rp?: number;
        rankLabel?: string;
        rankKey?: string;
      }>;
    };
    return (lad.leaderboard || []).slice(0, 10).map((r) => ({
      nick: String(r.nick || ""),
      rp: Number(r.rp) || 0,
      rankLabel: String(r.rankLabel || ""),
      rankKey: String(r.rankKey || ""),
      nickPatch: null,
      nickStyle: null,
    })).filter((r) => r.nick);
  } catch {
    return [];
  }
}

async function livePublicTop(): Promise<HomePublicTopRow[]> {
  try {
    const { loadPublicRpTopFromDb } = await import("@/lib/rpDbRead");
    const rows = await loadPublicRpTopFromDb(10);
    if (rows.length) {
      return rows.map((r) => ({
        nick: r.nick,
        rp: r.rp,
        rankLabel: r.predatorPlace
          ? `PREDATOR #${r.predatorPlace}`
          : r.rankLabel,
        rankKey: r.predatorPlace ? "predator" : r.rankKey,
        nickPatch: null,
        nickStyle: null,
      }));
    }
  } catch {
    /* fall through */
  }
  try {
    const board = await buildPublicRpLeaderboard();
    if (board.available && board.rows.length) {
      return board.rows.slice(0, 10).map((r) => ({
        nick: r.nick,
        rp: r.rp,
        rankLabel: r.rankLabel,
        rankKey: r.rankKey,
        nickPatch: null,
        nickStyle: null,
      }));
    }
  } catch {
    /* fall through */
  }
  return livePublicTopFromFile();
}

export async function getHomeDashboardData(): Promise<HomeDashboardCached> {
  const data = await snapshotOrBuild(
    "home-dashboard.json",
    90_000,
    buildHomeDashboard
  );
  const publicTop =
    data.publicTop.length > 0 ? data.publicTop : await livePublicTop();
  try {
    const { loadNickPatchByNick } = await import("@/lib/nickPatchesCache");
    const cosmetics = await loadNickPatchByNick();
    const next = {
      ...data,
      publicTop: applyLiveNickCosmetics(publicTop, cosmetics),
      pwrBoard: {
        ...data.pwrBoard,
        top10: applyLiveNickCosmetics(data.pwrBoard.top10, cosmetics),
      },
    };
    const nicks = [
      ...next.pwrBoard.top10.map((r) => r.nick),
      ...next.publicTop.map((r) => r.nick),
    ];
    void import("@/lib/profileViewSnapshot").then((m) =>
      m.kickProfileWarm(nicks)
    );
    return next;
  } catch {
    return { ...data, publicTop };
  }
}
