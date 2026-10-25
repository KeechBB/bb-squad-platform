import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const byKind = await p.canonMatch.groupBy({ by: ["kind"], _count: true });
const players = await p.canonMatchPlayer.count();
const sample = await p.canonMatch.findFirst({
  where: { legacyId: "25-alpha" },
  include: { _count: { select: { players: true } } },
});
console.log(
  JSON.stringify(
    {
      byKind,
      players,
      sampleAlpha: sample
        ? { matchKey: sample.matchKey, opp: sample.opp, meeting: sample.meeting, playerCount: sample._count.players }
        : null,
    },
    null,
    2
  )
);
await p.$disconnect();
