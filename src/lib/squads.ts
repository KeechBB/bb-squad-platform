import { prisma } from "@/lib/prisma";

export const DEFAULT_SQUAD_NAMES = ["Main", "Junior"] as const;

function isBbTagOrName(tag: string, name: string): boolean {
  const t = tag.trim().toLowerCase();
  const n = name.trim().toLowerCase();
  return t === "bb" || n === "blackberry";
}

/**
 * Main/Junior автосоздаются только у BlackBerry.
 * External: один раз сносим авто-Main/Junior (sortOrder 0/1), свои составы не трогаем.
 */
export async function ensureDefaultSquads(clanId: string) {
  const clan = await prisma.clan.findUnique({
    where: { id: clanId },
    select: { tag: true, name: true, isExternal: true },
  });
  if (!clan) return;

  if (clan.isExternal) {
    await purgeAutoDefaultSquads(clanId);
    return;
  }

  if (!isBbTagOrName(clan.tag, clan.name)) return;

  const existing = await prisma.clanSquad.findMany({
    where: { clanId },
    select: { name: true },
  });
  const have = new Set(existing.map((s) => s.name.toLowerCase()));
  const toCreate = DEFAULT_SQUAD_NAMES.filter((n) => !have.has(n.toLowerCase()));
  if (!toCreate.length) return;

  await prisma.clanSquad.createMany({
    data: toCreate.map((name, i) => ({
      clanId,
      name,
      sortOrder: name === "Main" ? 0 : name === "Junior" ? 1 : 10 + i,
    })),
  });
}

/**
 * Удалить только автосозданные Main/Junior (sortOrder 0/1).
 * Ручной состав с тем же именем (sortOrder ≥ 10) не удаляется.
 */
export async function purgeAutoDefaultSquads(clanId: string) {
  await prisma.clanSquad.deleteMany({
    where: {
      clanId,
      sortOrder: { lte: 1 },
      OR: [
        { name: { equals: "Main", mode: "insensitive" } },
        { name: { equals: "Junior", mode: "insensitive" } },
      ],
    },
  });
}

export async function ensureBbDefaultSquads() {
  const bb = await prisma.clan.findFirst({
    where: {
      OR: [
        { tag: { equals: "BB", mode: "insensitive" } },
        { name: { equals: "BlackBerry", mode: "insensitive" } },
      ],
    },
  });
  if (bb) await ensureDefaultSquads(bb.id);
}
