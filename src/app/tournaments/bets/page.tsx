import { TournamentBetsClient } from "@/components/TournamentBetsClient";
import "../../tournaments.css";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Прогнозы турнира · BlackBerry Squad",
};

export default function TournamentBetsPage() {
  return <TournamentBetsClient />;
}
