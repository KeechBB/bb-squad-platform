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
import { isBattlePassIntermission } from "@/lib/battlePassSchedule";

export const dynamic = "force-dynamic";

export default async function BattlePassPage() {
  /* После PB1 — 3 дня заглушки, пока Season 2 не выкатим */
  if (isBattlePassIntermission()) {
    return <BattlePassIntermission />;
  }

  const session = await getSession();
  let state = await loadBattlePassState();
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
