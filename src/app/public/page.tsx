import { PublicRatingLoader } from "@/components/PublicRatingLoader";

export const revalidate = 60;

/** Публичный рейтинг паблика — лёгкий SSR shell + JSON API (disk cache). */
export default function PublicRatingPage() {
  return (
    <main className="public-rating-page">
      <PublicRatingLoader />
    </main>
  );
}
