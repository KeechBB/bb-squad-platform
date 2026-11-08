import { cookies } from "next/headers";
import { PublicRatingClient } from "@/components/PublicRatingClient";
import { publicMatches, rating, updatedAt } from "../../fixtures";

export default async function Page() {
  const empty = (await cookies()).get("bb-preview-state")?.value === "empty";
  return <main className="public-rating-page"><PublicRatingClient rows={empty ? [] : rating} matches={empty ? 0 : 12} matchHistory={empty ? [] : publicMatches} updatedAt={updatedAt} /></main>;
}
