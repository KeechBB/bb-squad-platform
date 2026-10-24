import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { SITE_CREATOR_STEAM_ID } from "@/lib/profileBg";
import { BattlePassClient } from "@/components/BattlePassClient";
import { BP_S2_LEVELS, BP_S2_REWARDS } from "@/lib/battlePassSeason2";
import { buildSeason2PreviewMockLeaderboard } from "@/lib/battlePassSeason2Preview";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/** Season 2 Halloween BP — скрытое превью (только Keech). Живой /battle-pass не трогаем. */
export default async function HalloweenBattlePassPreviewPage() {
  const session = await getSession();
  if (!session?.user?.steamId || session.user.steamId !== SITE_CREATOR_STEAM_ID) {
    notFound();
  }

  const nick = session.user.nick || session.user.steamName || "Keech";
  const mock = await buildSeason2PreviewMockLeaderboard({
    selfNick: nick,
    cap: 50,
  });

  return (
    <BattlePassClient
      selfNick={nick}
      selfName={session.user.name || ""}
      selfAvatarUrl={session.user.avatarUrl || session.user.steamAvatar || null}
      selfProgress={mock.self}
      leaderboard={mock.board}
      statusNote="Скрытое превью Season 2 · только Keech"
      scoringEnabled
      layout="season2"
      seasonOverride={{
        title: "SEASON 2",
        subtitle: "Halloween · Фруктовый Сад",
        startLabel: "03.11.2026",
        endLabel: "30.11.2026",
      }}
      levelsOverride={BP_S2_LEVELS}
      rewardsOverride={BP_S2_REWARDS}
    />
  );
}
