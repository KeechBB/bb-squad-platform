/**
 * Серверная загрузка состояния турнирного хаба.
 * Клиент-безопасные хелперы — в tournamentHubShared.ts.
 */
import { prisma } from "@/lib/prisma";
import { loadFruitStrikeLive } from "@/lib/fruitStrikeLive";
import { ACTIVE_TOURNAMENT, formatTourDay } from "@/lib/tournaments";
import {
  TOURNAMENT_CUP_CATALOG,
  championWindowEnd,
  grandFinalDone,
  placesFromLive,
  resolveHubSurface,
  type TournamentHubState,
} from "@/lib/tournamentHubShared";

export * from "@/lib/tournamentHubShared";

export async function loadTeamLogoByTag(): Promise<Map<string, string | null>> {
  const rows = await prisma.tournamentTeam.findMany({
    select: { tag: true, logoUrl: true },
  });
  return new Map(
    rows.map((r) => [r.tag.trim().toUpperCase(), r.logoUrl ?? null] as const)
  );
}

export async function loadTournamentHubState(
  now = new Date()
): Promise<TournamentHubState> {
  const t = ACTIVE_TOURNAMENT;
  const live = await loadFruitStrikeLive();
  const surface = resolveHubSurface({ live, now, tournament: t });
  const logoByTag = await loadTeamLogoByTag();
  const places = placesFromLive(live, logoByTag);
  const gf = grandFinalDone(live);
  const championAt = gf && live?.updatedAt ? new Date(live.updatedAt) : null;
  const champion = places[0]
    ? {
        tag: places[0].tag,
        name: places[0].name,
        logoUrl: places[0].logoUrl,
      }
    : null;

  const historyCups = TOURNAMENT_CUP_CATALOG.filter((cup) => {
    if (cup.id === t.id) {
      return surface === "idle" || surface === "champion" || Boolean(gf);
    }
    return true;
  });

  return {
    surface,
    tournamentId: t.id,
    tournamentName: t.name,
    playDateLabel: formatTourDay(t.playDate),
    resultsDateLabel: formatTourDay(t.resultsDate),
    championWindowEndsAt: gf
      ? championWindowEnd(t, championAt).toISOString()
      : null,
    champion,
    places,
    historyCups,
  };
}
