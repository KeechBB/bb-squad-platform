/**
 * Display nick = Steam persona name.
 * User.nick остаётся unique в БД → при коллизии дописываем хвост steamId.
 */
import { prisma } from "@/lib/prisma";
import { normalizeNick } from "@/lib/validation";

export function nickFromSteamPersona(
  persona: string | null | undefined,
  steamId: string
): string {
  let base = normalizeNick(String(persona || ""));
  // Steam persona до ~32; чуть запас
  if (base.length > 64) base = base.slice(0, 64).trim();
  if (base.length < 2) {
    base = `player_${String(steamId || "").slice(-6) || "xxxx"}`;
  }
  return base;
}

/** Вернуть уникальный nick для этого steam (или уже свой). */
export async function allocateUniqueSteamNick(
  steamId: string,
  persona: string | null | undefined
): Promise<string> {
  const sid = String(steamId || "").trim();
  const desired = nickFromSteamPersona(persona, sid);

  const owner = await prisma.user.findFirst({
    where: { nick: { equals: desired, mode: "insensitive" } },
    select: { steamId: true },
  });
  if (!owner || owner.steamId === sid) return desired;

  const tail = sid.slice(-4);
  let candidate = `${desired} ·${tail}`;
  if (candidate.length > 64) {
    candidate = `${desired.slice(0, Math.max(2, 64 - tail.length - 2))}·${tail}`;
  }
  const taken = await prisma.user.findFirst({
    where: {
      nick: { equals: candidate, mode: "insensitive" },
      NOT: { steamId: sid },
    },
    select: { id: true },
  });
  if (!taken) return candidate;

  // крайний случай
  return `p${sid.slice(-10)}`;
}

/** Обновить User.nick из текущего steamName (логин / батч). */
export async function syncUserNickFromSteam(steamId: string): Promise<string | null> {
  const sid = String(steamId || "").trim();
  if (!sid) return null;
  const user = await prisma.user.findUnique({
    where: { steamId: sid },
    select: { nick: true, steamName: true, profileComplete: true },
  });
  if (!user?.profileComplete) return user?.nick ?? null;

  const next = await allocateUniqueSteamNick(sid, user.steamName);
  if (
    String(user.nick || "").localeCompare(next, undefined, {
      sensitivity: "accent",
    }) === 0
  ) {
    return user.nick;
  }
  await prisma.user.update({
    where: { steamId: sid },
    data: { nick: next },
  });
  return next;
}
