import { prisma } from "@/lib/prisma";

/** Участник любого клана на площадке (есть ClanMember). */
export async function isAnyClanMember(
  steamId: string | null | undefined
): Promise<boolean> {
  if (!steamId) return false;
  const user = await prisma.user.findUnique({
    where: { steamId },
    select: {
      clanMemberships: { take: 1, select: { id: true } },
    },
  });
  return Boolean(user?.clanMemberships[0]);
}

export async function getUserClanMembership(steamId: string | null | undefined) {
  if (!steamId) return null;
  const user = await prisma.user.findUnique({
    where: { steamId },
    select: {
      id: true,
      clanMemberships: {
        take: 1,
        select: {
          role: true,
          clanId: true,
          clan: { select: { id: true, tag: true, name: true, isExternal: true } },
        },
      },
    },
  });
  if (!user?.clanMemberships[0]) return null;
  return {
    userId: user.id,
    membership: user.clanMemberships[0],
  };
}
