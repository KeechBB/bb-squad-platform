import { TournamentBracketPage } from "@/components/TournamentBracketPage";
import "../../tournaments.css";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Сетка турнира · BlackBerry Squad",
};

export default function TournamentBracketRoute() {
  return <TournamentBracketPage />;
}
