import { prisma } from "@/lib/prisma";
import { findBlackberryClanIds } from "@/lib/reserve";

/** Участник клана BlackBerry (принял инвайт / вступил — есть ClanMember). */
export async function isBlackberryClanMember(
  steamId: string | null | undefined
): Promise<boolean> {
  if (!steamId) return false;
  const user = await prisma.user.findUnique({
    where: { steamId },
    select: { id: true },
  });
  if (!user) return false;

  const clanIds = await findBlackberryClanIds();
  if (clanIds.length === 0) return false;

  const membership = await prisma.clanMember.findFirst({
    where: {
      userId: user.id,
      clanId: { in: clanIds },
    },
    select: { id: true },
  });
  return Boolean(membership);
}
