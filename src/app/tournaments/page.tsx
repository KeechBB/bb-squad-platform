import { getSession } from "@/lib/auth";
import { TournamentsClient } from "@/components/TournamentsClient";
import "../tournaments.css";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Турниры · BlackBerry Squad",
};

export default async function TournamentsPage() {
  const session = await getSession();
  const nick = session?.user?.nick || session?.user?.steamName || "";

  return <TournamentsClient viewerNick={nick} />;
}
