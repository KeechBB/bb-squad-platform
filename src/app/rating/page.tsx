import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { buildClanEloBoard, buildEnemyPwrBoard } from "@/lib/crossRating";
import { CrossRatingClient } from "@/components/CrossRatingClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function RatingPage() {
  const session = await getSession();
  if (!session?.user?.steamId) redirect("/");
  if (!session.user.profileComplete) redirect("/register");

  const [clans, enemies] = await Promise.all([
    buildClanEloBoard(),
    buildEnemyPwrBoard(),
  ]);

  return (
    <main className="cross-rating-page">
      <CrossRatingClient clans={clans} enemies={enemies} />
    </main>
  );
}
