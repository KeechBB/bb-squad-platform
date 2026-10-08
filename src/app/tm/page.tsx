import { Suspense } from "react";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { isAnyClanMember } from "@/lib/clanAccess";
import { liveKvBust } from "@/lib/kvBust";
import { buildHomeTierBoard, emptyHomeTierBoard } from "@/lib/homeTierBoard";
import { TrainingMatchesHub } from "@/components/TrainingMatchesHub";

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
  const iframeSrc = `/kv-static/index.html?${params.toString()}#/tm`;
  const board = await buildHomeTierBoard().catch(() => emptyHomeTierBoard());

  return (
    <Suspense
      fallback={
        <div className="cw-embed">
          <iframe
            className="cw-frame"
            src={iframeSrc}
            title="Тренировочные матчи BlackBerry"
            allow="fullscreen"
          />
        </div>
      }
    >
      <TrainingMatchesHub iframeSrc={iframeSrc} board={board} />
    </Suspense>
  );
}
