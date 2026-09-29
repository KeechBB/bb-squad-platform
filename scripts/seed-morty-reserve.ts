/**
 * Бэкфилл: Morty в резерве с 19.09.2026 МСК (календарь «резерв»).
 * Запуск: npx tsx scripts/seed-morty-reserve.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** 2026-09-19 00:00 Europe/Moscow = 2026-09-18 21:00 UTC */
const ENTERED = new Date("2026-09-18T21:00:00.000Z");
/** запасной until — далеко вперёд, если у юзера нет reserveUntil */
const UNTIL_FALLBACK = new Date("2026-12-31T21:00:00.000Z");

async function main() {
  const u = await prisma.user.findFirst({
    where: { nick: { equals: "Morty", mode: "insensitive" } },
    select: {
      id: true,
      nick: true,
      reserveUntil: true,
      reserveReason: true,
    },
  });
  if (!u) {
    console.error("Morty not found");
    process.exit(1);
  }
  console.log("user", u);

  const open = await prisma.reserveStint.findFirst({
    where: { userId: u.id, exitedAt: null },
    orderBy: { enteredAt: "desc" },
  });

  const untilAt = u.reserveUntil ?? UNTIL_FALLBACK;
  const reason = u.reserveReason || "резерв (бэкфилл 19.09)";

  if (open) {
    const updated = await prisma.reserveStint.update({
      where: { id: open.id },
      data: { enteredAt: ENTERED },
    });
    console.log("updated open stint", updated.id, updated.enteredAt);
  } else {
    const created = await prisma.reserveStint.create({
      data: {
        userId: u.id,
        enteredAt: ENTERED,
        untilAt,
        reason,
        source: "admin",
        enteredById: u.id,
      },
    });
    console.log("created stint", created.id, created.enteredAt);
  }

  if (!u.reserveUntil) {
    await prisma.user.update({
      where: { id: u.id },
      data: { reserveUntil: untilAt, reserveReason: reason },
    });
    console.log("set user.reserveUntil", untilAt.toISOString());
  }

  const days = await prisma.reserveStint.findMany({
    where: { userId: u.id },
    orderBy: { enteredAt: "asc" },
  });
  console.log(
    "stints",
    days.map((s) => ({
      id: s.id,
      enteredAt: s.enteredAt.toISOString(),
      untilAt: s.untilAt.toISOString(),
      exitedAt: s.exitedAt?.toISOString() ?? null,
    }))
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
