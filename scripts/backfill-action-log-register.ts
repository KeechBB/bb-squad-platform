/**
 * Бэкофилл: регистрации (profileComplete) в ActionLog.
 * Дата = User.createdAt (первый вход Steam; точного времени анкеты нет).
 *
 *   npx tsx scripts/backfill-action-log-register.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function label(u: {
  nick: string | null;
  name: string | null;
  steamName: string | null;
  steamId: string;
}) {
  return u.nick || u.name || u.steamName || u.steamId;
}

async function main() {
  const users = await prisma.user.findMany({
    where: { profileComplete: true },
    select: {
      id: true,
      nick: true,
      name: true,
      steamName: true,
      steamId: true,
      regNo: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const existing = await prisma.actionLog.findMany({
    where: { action: "register" },
    select: { actorId: true },
  });
  const have = new Set(existing.map((e) => e.actorId).filter(Boolean));

  let n = 0;
  for (const u of users) {
    if (have.has(u.id)) continue;
    const nick = label(u);
    const message = `${nick} зарегистрировался на сайте${u.regNo != null ? ` (№${u.regNo})` : ""}`;
    const searchText = `${message} ${nick} register profile`.toLowerCase();
    await prisma.actionLog.create({
      data: {
        category: "profile",
        action: "register",
        message,
        searchText,
        actorId: u.id,
        actorNick: nick,
        createdAt: u.createdAt,
        meta: { regNo: u.regNo, steamId: u.steamId, backfill: true },
      },
    });
    n += 1;
  }
  console.log(`backfill register: +${n} (из ${users.length})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
