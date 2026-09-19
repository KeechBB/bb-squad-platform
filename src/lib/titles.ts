import { prisma } from "@/lib/prisma";
import type { ClanRole } from "@/lib/clan";

export const DEFAULT_CLAN_TITLES = ["HR"] as const;

export async function ensureDefaultTitles(clanId: string) {
  const existing = await prisma.clanTitle.findMany({
    where: { clanId },
    select: { name: true },
  });
  const have = new Set(existing.map((t) => t.name.toLowerCase()));
  const toCreate = DEFAULT_CLAN_TITLES.filter((n) => !have.has(n.toLowerCase()));
  if (!toCreate.length) return;

  await prisma.clanTitle.createMany({
    data: toCreate.map((name, i) => ({
      clanId,
      name,
      sortOrder: i,
    })),
  });
}

export function isValidTitleName(name: string): boolean {
  const t = name.trim();
  return t.length >= 2 && t.length <= 32;
}

/** Глава или носитель должности HR в этом клане */
export function isClanHrTitle(titleName: string | null | undefined): boolean {
  return Boolean(titleName && titleName.toLowerCase() === "hr");
}

export function canManageClanTitles(
  role: ClanRole,
  titleName: string | null | undefined
): boolean {
  if (role === "LEADER") return true;
  return isClanHrTitle(titleName);
}

/** Глава, зам или HR — раскидывать игроков по составам */
export function canAssignClanSquadMembers(
  role: ClanRole,
  titleName: string | null | undefined
): boolean {
  if (role === "LEADER" || role === "DEPUTY") return true;
  return isClanHrTitle(titleName);
}

/** HR не может менять должность главе клана — только сам глава */
export function canAssignTitleToMember(
  actorRole: ClanRole,
  targetRole: ClanRole
): boolean {
  if (targetRole === "LEADER") return actorRole === "LEADER";
  return true;
}
