import { prisma } from "@/lib/prisma";

const CLAN_TTL_MS = 20_000;
const clanFresh = new Map<string, { at: number; ok: boolean }>();

/** Участник любого клана на площадке (есть ClanMember). */
export async function isAnyClanMember(
  steamId: string | null | undefined
): Promise<boolean> {
  if (!steamId) return false;
  const hit = clanFresh.get(steamId);
  if (hit && Date.now() - hit.at < CLAN_TTL_MS) return hit.ok;
  const user = await prisma.user.findUnique({
    where: { steamId },
    select: {
      clanMemberships: { take: 1, select: { id: true } },
    },
  });
  const ok = Boolean(user?.clanMemberships[0]);
  clanFresh.set(steamId, { at: Date.now(), ok });
  if (clanFresh.size > 4000) {
    const now = Date.now();
    for (const [key, row] of clanFresh) {
      if (now - row.at > CLAN_TTL_MS) clanFresh.delete(key);
    }
  }
  return ok;
}

/** Страница: флаг уже лежит в сессии, базу не трогаем. */
export async function sessionIsClanMember(session: {
  user?: { steamId?: string | null; clanMember?: boolean };
} | null): Promise<boolean> {
  const steamId = session?.user?.steamId;
  if (!steamId) return false;
  if (typeof session.user?.clanMember === "boolean") return session.user.clanMember;
  return isAnyClanMember(steamId);
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

/** Основной (не external) клан игрока для ссылок «Мой клан». */
export async function getUserHomeClanId(
  steamId: string | null | undefined
): Promise<string | null> {
  if (!steamId) return null;
  const user = await prisma.user.findUnique({
    where: { steamId },
    select: {
      clanMemberships: {
        select: {
          clanId: true,
          clan: { select: { id: true, isExternal: true } },
        },
      },
    },
  });
  const rows = user?.clanMemberships || [];
  const real = rows.find((m) => m.clan && !m.clan.isExternal);
  return (real || rows[0])?.clanId ?? null;
}
