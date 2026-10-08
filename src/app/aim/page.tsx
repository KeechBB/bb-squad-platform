import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ReactionTrainingClient } from "@/components/ReactionTrainingClient";
import { GuestSteamGate } from "@/components/GuestSteamGate";

export const dynamic = "force-dynamic";

export default async function AimTrainingPage() {
  const session = await getSession();
  if (!session?.user?.steamId) {
    return (
      <GuestSteamGate
        title="Тренировка стрельбы"
        message="Авторизуйтесь через Steam, чтобы открыть этот раздел."
      />
    );
  }
  if (!session.user.profileComplete) redirect("/register");

  return (
    <main>
      <ReactionTrainingClient />
    </main>
  );
}
