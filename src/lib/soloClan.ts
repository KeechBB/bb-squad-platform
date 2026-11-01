import { prisma } from "@/lib/prisma";

/** Один участник — запоминаем, с какого момента клан соло. Второй игрок сбрасывает срок. */
export async function syncSoloSince(clanId: string) {
  const clan = await prisma.clan.findUnique({
    where: { id: clanId },
    select: { isExternal: true, soloSince: true },
  });
  if (!clan || clan.isExternal) return;

  const members = await prisma.clanMember.count({ where: { clanId } });
  if (members >= 2) {
    if (clan.soloSince) {
      await prisma.clan.update({
        where: { id: clanId },
        data: { soloSince: null },
      });
    }
    return;
  }
  if (members === 1 && !clan.soloSince) {
    await prisma.clan.update({
      where: { id: clanId },
      data: { soloSince: new Date() },
    });
  }
}
