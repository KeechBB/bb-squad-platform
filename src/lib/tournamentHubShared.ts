/**
 * Клиент-безопасные хелперы поверхности турнирного хаба (без prisma).
 */
import type { FruitLiveMatch, FruitLiveState } from "@/lib/fruitStrikeLiveView";
import {
  ACTIVE_TOURNAMENT,
  FRUIT_STRIKE_LOGO,
  formatTourDay,
  type ActiveTournamentDraft,
} from "@/lib/tournaments";

export type HubSurface = "active" | "champion" | "idle";

export type HubPlace = {
  place: 1 | 2 | 3;
  tag: string;
  name: string;
  logoUrl: string | null;
};

export type HubChampion = {
  tag: string;
  name: string;
  logoUrl: string | null;
};

export type TournamentCupRecord = {
  id: string;
  name: string;
  playDate: string;
  resultsDate: string;
  logoSrc: string;
  format: string;
  bracketHref: string;
};

/** Каталог кубков для вкладки «История турниров». */
export const TOURNAMENT_CUP_CATALOG: TournamentCupRecord[] = [
  {
    id: "fruit-strike-s1",
    name: "Fruit Strike Squad Cup Event #01",
    playDate: "2026-10-31",
    resultsDate: "2026-11-01",
    logoSrc: FRUIT_STRIKE_LOGO,
    format: "Двойное выбывание · 8×8 FCL",
    bracketHref: "/tournaments/bracket?cup=fruit-strike-s1",
  },
];

export const HUB_IDLE_COPY = {
  title: "Турниров пока нет",
  body: "На данный момент турниров не запланировано. Следите за новостями.",
  betsExtra:
    "Прогнозы привязаны к активному турниру — появятся вместе со следующим кубком.",
  hint: "Команды, статистика игроков, рейтинг команд и история матчей доступны во вкладках. Итоги прошедших кубков — в «Истории турниров».",
} as const;

function mskDayEnd(isoDay: string): Date {
  return new Date(`${isoDay}T23:59:59.999+03:00`);
}

/** Окно чемпиона: до конца resultsDate (МСК) и минимум 24ч с момента фиксации. */
export function championWindowEnd(
  t: ActiveTournamentDraft,
  championAt: Date | null
): Date {
  const byCalendar = mskDayEnd(t.resultsDate);
  if (!championAt || Number.isNaN(championAt.getTime())) return byCalendar;
  const byClock = new Date(championAt.getTime() + 24 * 60 * 60 * 1000);
  return byClock.getTime() > byCalendar.getTime() ? byClock : byCalendar;
}

export function grandFinalDone(live: FruitLiveState | null): FruitLiveMatch | null {
  const gf = live?.matches?.gf;
  if (!gf || gf.status !== "done") return null;
  if (!gf.winner?.tag && !gf.winner?.name) return null;
  return gf;
}

export function resolveHubSurface(opts: {
  live: FruitLiveState | null;
  now?: Date;
  tournament?: ActiveTournamentDraft;
}): HubSurface {
  const now = opts.now ?? new Date();
  const t = opts.tournament ?? ACTIVE_TOURNAMENT;
  const gf = grandFinalDone(opts.live);
  if (gf) {
    const championAt = opts.live?.updatedAt
      ? new Date(opts.live.updatedAt)
      : null;
    const end = championWindowEnd(t, championAt);
    if (now.getTime() <= end.getTime()) return "champion";
    return "idle";
  }
  // Кубок ещё без чемпиона — показываем анонс до конца дня итогов.
  if (now.getTime() <= mskDayEnd(t.resultsDate).getTime()) return "active";
  return "idle";
}

export function placeFrom(
  team: { tag?: string; name?: string } | undefined,
  place: 1 | 2 | 3,
  logoByTag: Map<string, string | null>
): HubPlace | null {
  if (!team?.tag && !team?.name) return null;
  const tag = String(team.tag || "").trim();
  const name = String(team.name || tag || "").trim();
  if (!tag && !name) return null;
  const logoUrl = tag
    ? logoByTag.get(tag.toUpperCase()) ?? null
    : null;
  return { place, tag: tag || name, name: name || tag, logoUrl };
}

export function placesFromLive(
  live: FruitLiveState | null,
  logoByTag: Map<string, string | null>
): HubPlace[] {
  const gf = grandFinalDone(live);
  if (!gf) return [];
  const out: HubPlace[] = [];
  const p1 = placeFrom(gf.winner, 1, logoByTag);
  const p2 = placeFrom(gf.loser, 2, logoByTag);
  if (p1) out.push(p1);
  if (p2) out.push(p2);
  const lf = live?.matches?.lf;
  if (lf?.status === "done") {
    const p3 = placeFrom(lf.loser, 3, logoByTag);
    if (
      p3 &&
      p3.tag.toUpperCase() !== p1?.tag.toUpperCase() &&
      p3.tag.toUpperCase() !== p2?.tag.toUpperCase()
    ) {
      out.push(p3);
    }
  }
  return out;
}

export type TournamentHubState = {
  surface: HubSurface;
  tournamentId: string;
  tournamentName: string;
  playDateLabel: string;
  resultsDateLabel: string;
  championWindowEndsAt: string | null;
  champion: HubChampion | null;
  places: HubPlace[];
  historyCups: TournamentCupRecord[];
};

export { formatTourDay };
