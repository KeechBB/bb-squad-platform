/**
 * Создатель (Keech / builtin super-admin) не влияет на экономику площадки:
 * его стоки и баланс не входят в «всего у пользователей» и в scarcity.
 */
import { getBuiltinSuperAdminIds } from "@/lib/admin";
import { SITE_CREATOR_STEAM_ID } from "@/lib/profileBg";
import { prisma } from "@/lib/prisma";

let cache: { at: number; ids: string[] } | null = null;
const CACHE_MS = 60_000;

export function invalidateEconomyExcludedUserIds() {
  cache = null;
}

/** User.id создателя(ей) — исключать из supply / агрегатов экономики. */
export async function economyExcludedUserIds(): Promise<string[]> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) return cache.ids;

  const steamIds = [
    ...new Set([...getBuiltinSuperAdminIds(), SITE_CREATOR_STEAM_ID]),
  ];
  const rows = await prisma.user.findMany({
    where: { steamId: { in: steamIds } },
    select: { id: true },
  });
  const ids = rows.map((r) => r.id);
  cache = { at: now, ids };
  return ids;
}

/** Prisma where-фрагмент: stock без создателя. */
export async function economyStockUserFilter(): Promise<
  { userId?: { notIn: string[] } }
> {
  const ids = await economyExcludedUserIds();
  if (!ids.length) return {};
  return { userId: { notIn: ids } };
}

export function isEconomyExcludedSteamId(
  steamId: string | null | undefined
): boolean {
  if (!steamId) return false;
  return (
    getBuiltinSuperAdminIds().has(steamId) || steamId === SITE_CREATOR_STEAM_ID
  );
}
