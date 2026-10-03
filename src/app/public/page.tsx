import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { PublicRatingClient } from "@/components/PublicRatingClient";
import { buildPublicRatingTable } from "@/lib/publicCombat";
import { listPublicMatches } from "@/lib/publicMatches";

export const dynamic = "force-dynamic";

export default async function PublicRatingPage() {
  const session = await getSession();
  if (!session?.user?.steamId) redirect("/?login=1");
  if (!session.user.profileComplete) redirect("/register");

  const [board, matchHistory] = await Promise.all([
    buildPublicRatingTable(200),
    listPublicMatches(800),
  ]);
  return (
    <main className="public-rating-page">
      <PublicRatingClient
        rows={board.rows}
        matches={board.matches}
        matchHistory={matchHistory}
        updatedAt={board.updatedAt}
      />
    </main>
  );
}
