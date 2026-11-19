/**
 * One-shot: выдать Keech СВД «Повелитель фракций» и надеть.
 */
const { PrismaClient } = require("@prisma/client");

const STEAM = "76561198028435874";
const PATCH = "creator-svd-faction-lord";

const p = new PrismaClient();

async function main() {
  const u = await p.user.findFirst({
    where: { steamId: STEAM },
    select: { id: true, nick: true, unlockedNickPatches: true },
  });
  if (!u) throw new Error("Keech not found");

  const row = await p.nickPatchStock.upsert({
    where: { userId_patchId: { userId: u.id, patchId: PATCH } },
    create: { userId: u.id, patchId: PATCH, qty: 1 },
    update: {},
  });

  const list = Array.isArray(u.unlockedNickPatches)
    ? [...u.unlockedNickPatches]
    : [];
  if (!list.includes(PATCH)) list.push(PATCH);

  await p.user.update({
    where: { id: u.id },
    data: {
      unlockedNickPatches: list,
      nickPatchId: PATCH,
    },
  });

  console.log(
    JSON.stringify(
      { ok: true, nick: u.nick, patch: PATCH, qty: row.qty, unlocked: list },
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
  .finally(() => p.$disconnect());
