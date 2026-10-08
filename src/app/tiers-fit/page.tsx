import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { isAnyClanMember } from "@/lib/clanAccess";
import { buildHomeTierBoard, emptyHomeTierBoard } from "@/lib/homeTierBoard";
import { TierFitPageClient } from "@/components/TierFitPageClient";

export const dynamic = "force-dynamic";

export default async function TiersFitPage() {
  const session = await getSession();
  if (!session?.user?.steamId) redirect("/?login=1");
  if (!session.user.profileComplete) redirect("/register");
  if (!(await isAnyClanMember(session.user.steamId))) {
    redirect("/clans");
  }

  const board = await buildHomeTierBoard().catch(() => emptyHomeTierBoard());
  return <TierFitPageClient board={board} />;
}
