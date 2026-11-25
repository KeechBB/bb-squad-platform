#!/usr/bin/env node
/**
 * Angel BB: DeployRole "angel" after 18.11 landed on wrong steam
 * (Possess Online ID), while Login sessions stayed on Sanya BB.
 * Reassign overlapping role events → rebuild profile train history.
 */
const { PrismaClient } = require("@prisma/client");

const SANYA = "76561198941350361";
const WRONG = "76561199561407374";

async function main() {
  const p = new PrismaClient();
  try {
    const before = await p.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM "SquadRoleEvent" WHERE "steamId"=$1 AND "spawnedAt" >= '2026-11-19'::timestamptz`,
      WRONG
    );
    console.log("wrong_roles_since_19", before[0]?.n);

    const updated = await p.$executeRawUnsafe(
      `UPDATE "SquadRoleEvent" r
       SET "steamId" = $1,
           "userId" = (SELECT id FROM "User" WHERE "steamId"=$1 LIMIT 1)
       FROM "SquadServerSession" s
       WHERE r."steamId" = $2
         AND lower(coalesce(r."nickAtSpawn", '')) LIKE '%angel%'
         AND s."steamId" = $1
         AND s."serverKey" = r."serverKey"
         AND r."spawnedAt" >= s."joinedAt"
         AND r."spawnedAt" <= coalesce(s."leftAt", now())
         AND lower(coalesce(s."nickAtJoin", '')) LIKE '%angel%'`,
      SANYA,
      WRONG
    );
    console.log("reassigned", updated);

    const afterWrong = await p.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM "SquadRoleEvent" WHERE "steamId"=$1 AND "spawnedAt" >= '2026-11-19'::timestamptz AND lower(coalesce("nickAtSpawn",'')) LIKE '%angel%'`,
      WRONG
    );
    const afterSanya = await p.$queryRawUnsafe(
      `SELECT to_char(("spawnedAt" AT TIME ZONE 'Europe/Moscow'), 'YYYY-MM-DD') AS d,
              count(*)::int AS n
       FROM "SquadRoleEvent"
       WHERE "steamId"=$1 AND "spawnedAt" >= '2026-11-19'::timestamptz
         AND lower(coalesce("nickAtSpawn",'')) LIKE '%angel%'
         AND "serverKey" LIKE 'TR%'
       GROUP BY 1 ORDER BY 1`,
      SANYA
    );
    console.log("wrong_angel_left", afterWrong[0]?.n);
    console.log("sanya_tr_angel_by_day", afterSanya);
  } finally {
    await p.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
