import { PublicRatingClient } from "@/components/PublicRatingClient";
import { buildPublicRatingTable } from "@/lib/publicCombat";
import { listPublicMatches } from "@/lib/publicMatches";

export const dynamic = "force-dynamic";

/** Публичный рейтинг паблика — доступен без Steam-логина. */
export default async function PublicRatingPage() {
  const [board, matchHistory] = await Promise.all([
    buildPublicRatingTable(500),
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
