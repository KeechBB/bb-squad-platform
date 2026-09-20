import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Assign in createdAt order for everyone with completed profile and no regNo yet.
  // First pass: if nobody has regNo, assign 1..N strictly by createdAt.
  const withNo = await prisma.user.count({ where: { regNo: { not: null } } });
  if (withNo === 0) {
    const all = await prisma.user.findMany({
      where: { profileComplete: true },
      orderBy: { createdAt: "asc" },
      select: { id: true, nick: true, steamId: true, createdAt: true },
    });
    let n = 1;
    for (const u of all) {
      await prisma.user.update({ where: { id: u.id }, data: { regNo: n } });
      console.log(n, u.nick || u.steamId, u.createdAt.toISOString());
      n += 1;
    }
    console.log("backfill fresh done", all.length);
  } else {
    const pending = await prisma.user.findMany({
      where: { profileComplete: true, regNo: null },
      orderBy: { createdAt: "asc" },
      select: { id: true, nick: true },
    });
    for (const u of pending) {
      const agg = await prisma.user.aggregate({ _max: { regNo: true } });
      const next = (agg._max.regNo ?? 0) + 1;
      await prisma.user.update({ where: { id: u.id }, data: { regNo: next } });
      console.log(next, u.nick);
    }
    console.log("backfill append done", pending.length);
  }

  const keech = await prisma.user.findFirst({
    where: { nick: { equals: "Keech", mode: "insensitive" } },
    select: { nick: true, regNo: true, createdAt: true },
  });
  console.log("Keech =>", keech);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
