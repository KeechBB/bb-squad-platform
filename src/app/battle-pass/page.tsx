import { getSession } from "@/lib/auth";
import { BattlePassClient } from "@/components/BattlePassClient";
import { emptySelfProgress } from "@/lib/battlePass";
import {
  battlePassLeaderboard,
  battlePassStatusNote,
  loadBattlePassState,
  progressForNick,
} from "@/lib/battlePassData";

export const dynamic = "force-dynamic";

export default async function BattlePassPage() {
  const session = await getSession();
  const state = await loadBattlePassState();

  const nick =
    session?.user?.nick || session?.user?.steamName || "Гость";
  const name = session?.user?.name || "";
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
      leaderboard={battlePassLeaderboard(state)}
      statusNote={battlePassStatusNote(state)}
      scoringEnabled={Boolean(state?.enabled && state.cutoverAfterMatchId)}
    />
  );
}
