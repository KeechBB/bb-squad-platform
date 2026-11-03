/**
 * Phase 6: User.nick = текущий steamName (уникальность через allocateUniqueSteamNick).
 * Два прохода: сначала освобождаем старые ники (→ временные), потом ставим целевые —
 * иначе case-insensitive коллизия (Angel vs angel) ломает «своих».
 *
 *   npx tsx scripts/sync-steam-nicks.ts
 *   npx tsx scripts/sync-steam-nicks.ts --dry
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const dry = process.argv.includes("--dry");

function nickFromSteamPersona(persona: string | null | undefined, steamId: string): string {
  let base = String(persona || "")
    .trim()
    .replace(/\s+/g, " ");
  if (base.length > 64) base = base.slice(0, 64).trim();
  if (base.length < 2) {
    base = `player_${String(steamId || "").slice(-6) || "xxxx"}`;
  }
  return base;
}

async function allocateUniqueSteamNick(
  steamId: string,
  persona: string | null | undefined,
  reservedByOther: Set<string>
): Promise<string> {
  const sid = String(steamId || "").trim();
  const desired = nickFromSteamPersona(persona, sid);
  const key = desired.toLowerCase();

  const owner = await prisma.user.findFirst({
    where: { nick: { equals: desired, mode: "insensitive" } },
    select: { steamId: true },
  });
  if ((!owner || owner.steamId === sid) && !reservedByOther.has(key)) {
    return desired;
  }

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
  if (!taken && !reservedByOther.has(candidate.toLowerCase())) return candidate;

  return `p${sid.slice(-10)}`;
}

async function main() {
  const users = await prisma.user.findMany({
    where: { profileComplete: true },
    select: { id: true, steamId: true, nick: true, steamName: true },
    orderBy: { createdAt: "asc" },
  });

  // Целевые ники (без учёта занятости — уточним во 2-м проходе)
  const targets = new Map<string, string>();
  for (const u of users) {
    targets.set(u.steamId, nickFromSteamPersona(u.steamName, u.steamId));
  }

  const changing = users.filter((u) => {
    const next = targets.get(u.steamId)!;
    return (
      String(u.nick || "").localeCompare(next, undefined, {
        sensitivity: "accent",
      }) !== 0
    );
  });

  // Pass 1: освободить ники у тех, кто всё равно сменит (временный уникальный)
  for (const u of changing) {
    const tmp = `__sync_${u.steamId.slice(-10)}`;
    console.log(`${dry ? "[dry] " : ""}pass1 ${u.nick} → ${tmp}`);
    if (!dry) {
      await prisma.user.update({
        where: { id: u.id },
        data: { nick: tmp },
      });
    }
  }

  // Pass 2: целевые ники; reserved = уже выданные в этом проходе
  const reserved = new Set<string>();
  let changed = 0;
  let same = 0;
  for (const u of users) {
    const next = await allocateUniqueSteamNick(
      u.steamId,
      u.steamName,
      reserved
    );
    reserved.add(next.toLowerCase());
    const prev = String(u.nick || "");
    if (
      prev.localeCompare(next, undefined, { sensitivity: "accent" }) === 0 &&
      !changing.some((c) => c.steamId === u.steamId)
    ) {
      same += 1;
      continue;
    }
    console.log(`${dry ? "[dry] " : ""}pass2 ${prev} → ${next} (${u.steamId})`);
    if (!dry) {
      await prisma.user.update({
        where: { id: u.id },
        data: { nick: next },
      });
    }
    changed += 1;
  }
  console.log(
    JSON.stringify(
      { total: users.length, changed, same, pass1: changing.length, dry },
      null,
      2
    )
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
