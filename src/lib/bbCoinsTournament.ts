import { prisma } from "@/lib/prisma";
import { tournamentBetsPayload } from "@/lib/tournamentBets";
import { ensureTournamentBbCoinGrant } from "@/lib/bbCoins";
import { ACTIVE_TOURNAMENT } from "@/lib/tournaments";

/** Верные ответы текущего турнира для userId, или null если бланка нет / итоги закрыты. */
export async function gradeMineTournamentBet(
  userId: string
): Promise<number | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, profileComplete: true },
  });
  if (!user?.profileComplete) return null;
  const payload = await tournamentBetsPayload(user);
  if (!payload.reveal?.open) return null;
  const mine = payload.board.find((r) => r.mine);
  if (!mine) return null;
  return mine.correct;
}

export async function settleActiveTournamentBbCoins(userId: string) {
  const correct = await gradeMineTournamentBet(userId);
  if (correct == null) {
    return { granted: 0, balance: null as number | null };
  }
  return ensureTournamentBbCoinGrant({
    userId,
    tournamentId: ACTIVE_TOURNAMENT.id,
    correctAnswers: correct,
  });
}
