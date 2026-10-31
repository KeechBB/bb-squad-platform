import { getSession } from "@/lib/auth";
import { TournamentsClient } from "@/components/TournamentsClient";
import { isTournamentTab } from "@/lib/tournaments";
import { loadTournamentHubState } from "@/lib/tournamentHub";
import "../tournaments.css";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Турниры · BlackBerry Squad",
};

type Props = { searchParams?: Promise<{ tab?: string }> };

export default async function TournamentsPage({ searchParams }: Props) {
  const session = await getSession();
  const nick = session?.user?.nick || session?.user?.steamName || "";
  const sp = searchParams ? await searchParams : {};
  const initialTab = isTournamentTab(sp.tab) ? sp.tab : "tournaments";
  const hub = await loadTournamentHubState();

  return (
    <TournamentsClient viewerNick={nick} initialTab={initialTab} hub={hub} />
  );
}
