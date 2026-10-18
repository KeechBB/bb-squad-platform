import { getSession } from "@/lib/auth";
import { BattlePassClient } from "@/components/BattlePassClient";
import {
  emptyLeaderboard,
  emptySelfProgress,
} from "@/lib/battlePass";

export const dynamic = "force-dynamic";

export default async function BattlePassPage() {
  const session = await getSession();

  const nick =
    session?.user?.nick || session?.user?.steamName || "Гость";
  const name = session?.user?.name || "";
  const avatarUrl =
    session?.user?.avatarUrl || session?.user?.steamAvatar || null;

  return (
    <BattlePassClient
      selfNick={nick}
      selfName={name}
      selfAvatarUrl={avatarUrl}
      selfProgress={emptySelfProgress(nick)}
      leaderboard={emptyLeaderboard()}
    />
  );
}
