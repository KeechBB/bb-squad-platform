import { PublicRatingLoader } from "@/components/PublicRatingLoader";
import { getPublicRatingPagePayload } from "@/lib/publicRatingPageCache";

export const dynamic = "force-dynamic";

/** Рейтинг паблика уже в первом ответе — снимок с диска, без второго запроса на 342 КБ. */
export default async function PublicRatingPage() {
  const data = await getPublicRatingPagePayload();
  return (
    <main className="public-rating-page">
      <PublicRatingLoader
        initial={{
          rows: data.board.rows,
          matches: data.board.matches,
          updatedAt: data.board.updatedAt,
          matchHistory: data.matchHistory,
        }}
      />
    </main>
  );
}
