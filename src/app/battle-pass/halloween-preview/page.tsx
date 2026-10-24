import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { SITE_CREATOR_STEAM_ID } from "@/lib/profileBg";
import { BattlePassClient } from "@/components/BattlePassClient";
import { emptySelfProgress } from "@/lib/battlePass";
import { BP_S2_LEVELS, BP_S2_REWARDS } from "@/lib/battlePassSeason2";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/** Season 2 Halloween BP — скрытое превью (только Keech). */
export default async function HalloweenBattlePassPreviewPage() {
  const session = await getSession();
  if (!session?.user?.steamId || session.user.steamId !== SITE_CREATOR_STEAM_ID) {
    notFound();
  }

  const nick = session.user.nick || session.user.steamName || "Keech";

  return (
    <BattlePassClient
      selfNick={nick}
      selfName={session.user.name || ""}
      selfAvatarUrl={session.user.avatarUrl || session.user.steamAvatar || null}
      selfProgress={emptySelfProgress(nick)}
      leaderboard={[]}
      statusNote="Скрытое превью Season 2 · только Keech · задания 21–25 — черновик"
      scoringEnabled={false}
      layout="season2"
      detailTheme="halloween"
      seasonOverride={{
        title: "SEASON 2",
        subtitle: "Halloween · Фруктовый Сад",
        startLabel: "03.11.2026",
        endLabel: "30.11.2026",
      }}
      detailBg="/bp-halloween/hero-squad.jpg"
      sideArtUrl={null}
      levelsOverride={BP_S2_LEVELS}
      rewardsOverride={BP_S2_REWARDS}
    />
  );
}
