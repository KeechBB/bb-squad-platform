import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ReactionTrainingClient } from "@/components/ReactionTrainingClient";

export const dynamic = "force-dynamic";

export default async function AimTrainingPage() {
  const session = await getSession();
  if (!session?.user?.steamId) redirect("/");
  if (!session.user.profileComplete) redirect("/register");

  return (
    <main>
      <ReactionTrainingClient />
    </main>
  );
}
