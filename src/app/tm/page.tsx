import { Suspense } from "react";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { isAnyClanMember } from "@/lib/clanAccess";
import { liveKvBust } from "@/lib/kvBust";
import { buildHomeTierBoard, emptyHomeTierBoard } from "@/lib/homeTierBoard";
import { TrainingMatchesHub } from "@/components/TrainingMatchesHub";
import { KvAutoHeightFrame } from "@/components/KvAutoHeightFrame";

export const dynamic = "force-dynamic";

export default async function TrainingMatchesPage() {
  const session = await getSession();
  if (!session?.user?.steamId) redirect("/?login=1");
  if (!session.user.profileComplete) redirect("/register");
  if (!(await isAnyClanMember(session.user.steamId))) {
    redirect("/clans");
  }

  const bust = await liveKvBust();
  // Матчи: без дубля «Тиры Fit» в subnav — детальный FIT живёт в большой вкладке
  const matchParams = new URLSearchParams({
    embed: "1",
    hideTiers: "1",
    v: bust,
  });
  const iframeSrc = `/kv-static/index.html?${matchParams.toString()}#/tm`;
  // Большая «Тиры FIT»: полный разбор из KV tfs-fit (доски / кандидаты / аналитика)
  const fitParams = new URLSearchParams({
    embed: "1",
    tfsEmbed: "1",
    v: bust,
  });
  const fitIframeSrc = `/kv-static/index.html?${fitParams.toString()}#/tm/tiers`;
  const board = await buildHomeTierBoard().catch(() => emptyHomeTierBoard());

  return (
    <Suspense
      fallback={
        <KvAutoHeightFrame
          src={iframeSrc}
          title="Тренировочные матчи BlackBerry"
        />
      }
    >
      <TrainingMatchesHub
        iframeSrc={iframeSrc}
        fitIframeSrc={fitIframeSrc}
        board={board}
      />
    </Suspense>
  );
}
