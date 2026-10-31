import { TournamentBetsClient } from "@/components/TournamentBetsClient";
import { TournamentHubFrame } from "@/components/TournamentHubFrame";
import { TournamentHubIdle } from "@/components/TournamentHubIdle";
import { loadTournamentHubState } from "@/lib/tournamentHub";
import "../../tournaments.css";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Прогнозы турнира · BlackBerry Squad",
};

export default async function TournamentBetsPage() {
  const hub = await loadTournamentHubState();
  if (hub.surface === "idle") {
    return (
      <TournamentHubFrame active="bets">
        <TournamentHubIdle kind="bets" />
      </TournamentHubFrame>
    );
  }
  return <TournamentBetsClient />;
}
