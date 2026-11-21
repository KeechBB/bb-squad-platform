import { prisma } from "@/lib/prisma";
import { isBuiltinSuperAdmin } from "@/lib/admin";
import { normalizeClanTag } from "@/lib/clanMapColor";
import type { ClanRole } from "@/lib/clan";

/** Кланы с кнопкой «Выдать VIP» главе/заму. */
const VIP_CLAN_TAGS = new Set(["BB", "DL", "A", "HIVE"]);

export function isPlatformClanOwner(steamId: string | null | undefined): boolean {
  return isBuiltinSuperAdmin(steamId);
}

export function clanAllowsVipGrants(tag: string | null | undefined): boolean {
  return VIP_CLAN_TAGS.has(normalizeClanTag(tag));
}

export function canGrantClanVip(role: ClanRole | null | undefined): boolean {
  return role === "LEADER" || role === "DEPUTY";
}

export type ClanActor = {
  user: {
    id: string;
    nick: string | null;
    name: string | null;
    steamName: string | null;
    steamId: string | null;
  };
  member: {
    id: string;
    role: ClanRole;
    userId: string;
    clanId: string;
    title: { name: string } | null;
  };
  /** Владелец платформы без ClanMember — права главы, в составе не числится */
  virtual: boolean;
};

/**
 * Участник клана или владелец платформы с виртуальными правами главы.
 * В списке состава virtual-актор не появляется.
 */
export async function resolveClanActor(
  clanId: string,
  steamId: string
): Promise<ClanActor | null> {
  const user = await prisma.user.findUnique({
    where: { steamId },
    select: {
      id: true,
      nick: true,
      name: true,
      steamName: true,
      steamId: true,
    },
  });
  if (!user) return null;

  const member = await prisma.clanMember.findUnique({
    where: { clanId_userId: { clanId, userId: user.id } },
    include: { title: { select: { name: true } } },
  });
  if (member) {
    return {
      user,
      member: {
        id: member.id,
        role: member.role as ClanRole,
        userId: member.userId,
        clanId: member.clanId,
        title: member.title,
      },
      virtual: false,
    };
  }

  if (!isPlatformClanOwner(steamId)) return null;

  return {
    user,
    member: {
      id: `__platform__${user.id}`,
      role: "LEADER",
      userId: user.id,
      clanId,
      title: null,
    },
    virtual: true,
  };
}
