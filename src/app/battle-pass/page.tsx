import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { isBuiltinSuperAdmin } from "@/lib/admin";
import { BattlePassClient } from "@/components/BattlePassClient";
import {
  emptyLeaderboard,
  emptySelfProgress,
} from "@/lib/battlePass";

export const dynamic = "force-dynamic";

export default async function BattlePassPage() {
  const session = await getSession();
  // Beta: только Keech. Остальным — как будто раздела нет.
  if (!isBuiltinSuperAdmin(session?.user?.steamId)) notFound();

  const nick = session?.user?.nick || session?.user?.steamName || "Keech";
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
