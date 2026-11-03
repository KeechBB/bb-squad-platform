/**
 * Phase 6: User.nick = текущий steamName (уникальность через allocateUniqueSteamNick).
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

  return `p${sid.slice(-10)}`;
}

async function main() {
  const users = await prisma.user.findMany({
    where: { profileComplete: true },
    select: { id: true, steamId: true, nick: true, steamName: true },
    orderBy: { createdAt: "asc" },
  });

  let changed = 0;
  let same = 0;
  for (const u of users) {
    const next = await allocateUniqueSteamNick(u.steamId, u.steamName);
    const prev = String(u.nick || "");
    if (prev.localeCompare(next, undefined, { sensitivity: "accent" }) === 0) {
      same += 1;
      continue;
    }
    console.log(`${dry ? "[dry] " : ""}${prev} → ${next} (${u.steamId})`);
    if (!dry) {
      await prisma.user.update({
        where: { id: u.id },
        data: { nick: next },
      });
    }
    changed += 1;
  }
  console.log(
    JSON.stringify({ total: users.length, changed, same, dry }, null, 2)
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
