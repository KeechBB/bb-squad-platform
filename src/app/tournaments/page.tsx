import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { isBuiltinSuperAdmin } from "@/lib/admin";
import { TournamentsClient } from "@/components/TournamentsClient";
import "../tournaments.css";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Турниры · BlackBerry Squad",
};

export default async function TournamentsPage() {
  const session = await getSession();
  // Beta: только Keech. Остальным — как будто раздела нет.
  if (!isBuiltinSuperAdmin(session?.user?.steamId)) notFound();

  const nick =
    session?.user?.nick || session?.user?.steamName || "Keech";

  return <TournamentsClient viewerNick={nick} />;
}
