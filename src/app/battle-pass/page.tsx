import { getSession } from "@/lib/auth";
import { BattlePassClient } from "@/components/BattlePassClient";
import { BattlePassIntermission } from "@/components/BattlePassIntermission";
import { emptySelfProgress } from "@/lib/battlePass";
import {
  battlePassLeaderboardTop10,
  battlePassStatusNote,
  ensureBattlePassL20Finale,
  loadBattlePassState,
  progressForNick,
} from "@/lib/battlePassData";
import {
  BP_S2_SCHEDULE,
  isBattlePassIntermission,
  isBattlePassSeason2Live,
} from "@/lib/battlePassSchedule";
import { BP_S2_LEVELS, BP_S2_REWARDS } from "@/lib/battlePassSeason2";

export const dynamic = "force-dynamic";

export default async function BattlePassPage() {
  /* После PB1 — 3 дня заглушки, пока Season 2 не выкатим */
  if (isBattlePassIntermission()) {
    return <BattlePassIntermission />;
  }

  const session = await getSession();
  let state = await loadBattlePassState();

  if (isBattlePassSeason2Live()) {
    const nick =
      session?.user?.nick || session?.user?.steamName || "Гость";
    const avatarUrl =
      session?.user?.avatarUrl || session?.user?.steamAvatar || null;
    const selfProgress =
      session?.user?.profileComplete && session.user.nick
        ? progressForNick(state, session.user.nick)
        : emptySelfProgress(nick);

    return (
      <BattlePassClient
        selfNick={nick}
        selfName=""
        selfAvatarUrl={avatarUrl}
        selfProgress={selfProgress}
        leaderboard={battlePassLeaderboardTop10(state)}
        statusNote={battlePassStatusNote(state)}
        scoringEnabled={Boolean(state?.enabled && state.cutoverAfterMatchId)}
        layout="season2"
        seasonOverride={{
          title: BP_S2_SCHEDULE.title,
          subtitle: BP_S2_SCHEDULE.subtitle,
          startLabel: BP_S2_SCHEDULE.startLabel,
          endLabel: BP_S2_SCHEDULE.endLabel,
        }}
        levelsOverride={BP_S2_LEVELS}
        rewardsOverride={BP_S2_REWARDS}
      />
    );
  }

  /* Fallback: архив S1 (не должен светиться после 04.11) */
  state = await ensureBattlePassL20Finale(state);

  const nick =
    session?.user?.nick || session?.user?.steamName || "Гость";
  const name = "";
  const avatarUrl =
    session?.user?.avatarUrl || session?.user?.steamAvatar || null;

  const selfProgress =
    session?.user?.profileComplete && session.user.nick
      ? progressForNick(state, session.user.nick)
      : emptySelfProgress(nick);

  return (
    <BattlePassClient
      selfNick={nick}
      selfName={name}
      selfAvatarUrl={avatarUrl}
      selfProgress={selfProgress}
      leaderboard={battlePassLeaderboardTop10(state)}
      statusNote={battlePassStatusNote(state)}
      scoringEnabled={Boolean(state?.enabled && state.cutoverAfterMatchId)}
    />
  );
}
