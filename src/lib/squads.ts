import { prisma } from "@/lib/prisma";

export const DEFAULT_SQUAD_NAMES = ["Main", "Junior"] as const;

export async function ensureDefaultSquads(clanId: string) {
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
