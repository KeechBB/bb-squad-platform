import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { isAnyClanMember } from "@/lib/clanAccess";
import { liveKvBust } from "@/lib/kvBust";

export const dynamic = "force-dynamic";

export default async function TrainingMatchesPage() {
  const session = await getSession();
  if (!session?.user?.steamId) redirect("/?login=1");
  if (!session.user.profileComplete) redirect("/register");
  if (!(await isAnyClanMember(session.user.steamId))) {
    redirect("/clans");
  }

  const bust = await liveKvBust();
  const params = new URLSearchParams({ embed: "1", v: bust });
  const q = `?${params.toString()}#/tm`;

  return (
    <div className="cw-embed">
      <iframe
        className="cw-frame"
        src={`/kv-static/index.html${q}`}
        title="Тренировочные матчи BlackBerry"
        allow="fullscreen"
      />
    </div>
  );
}
