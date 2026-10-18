import { PublicRatingClient } from "@/components/PublicRatingClient";
import { getPublicRatingPagePayload } from "@/lib/publicRatingPageCache";

export const revalidate = 60;

/** Публичный рейтинг паблика — доступен без Steam-логина. */
export default async function PublicRatingPage() {
  const { board, matchHistory } = await getPublicRatingPagePayload();
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
