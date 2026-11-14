/**
 * Каталог и сделки центробанка нашивок за BB Coins.
 */
import { prisma } from "@/lib/prisma";
import { isProfilePatchId, type ProfilePatchId } from "@/lib/profilePatches";
import { creditBbCoins, debitBbCoins, getBbCoinBalance } from "@/lib/bbCoins";
import {
  MARKET_PATCH_ORDER,
  marketPatchMeta,
  patchBuyPriceBbc,
  patchSellPriceBbc,
  type MarketPatchCard,
} from "@/lib/bbCoinPatchPrices";
import { SITE_CREATOR_STEAM_ID } from "@/lib/profileBg";
import { writeNickPatchesCache } from "@/lib/nickPatchesCache";

async function supplyByPatchId(): Promise<Map<string, number>> {
  const rows = await prisma.$queryRawUnsafe<
    Array<{ patch_id: string; n: number }>
  >(
    `
    SELECT u.patch_id, COUNT(*)::int AS n
    FROM (
      SELECT UNNEST("unlockedNickPatches") AS patch_id
      FROM "User"
    ) u
    WHERE u.patch_id = ANY($1::text[])
    GROUP BY u.patch_id
  `,
    [...MARKET_PATCH_ORDER]
  );
  return new Map(rows.map((r) => [r.patch_id, Number(r.n) || 0]));
}

/** Keech по умолчанию владеет 1 шт каждой, если id ещё нет в его unlocks. */
function keechDefaultExtra(
  patchId: ProfilePatchId,
  keechUnlocks: ReadonlySet<string>
): number {
  return keechUnlocks.has(patchId) ? 0 : 1;
}

export async function loadMarketPatchCatalog(opts: {
  userId: string;
  steamId: string;
}): Promise<MarketPatchCard[]> {
  const me = await prisma.user.findUnique({
    where: { id: opts.userId },
    select: { unlockedNickPatches: true },
  });
  const myUnlocks = new Set(me?.unlockedNickPatches || []);

  const keech = await prisma.user.findUnique({
    where: { steamId: SITE_CREATOR_STEAM_ID },
    select: { unlockedNickPatches: true },
  });
  const keechUnlocks = new Set(keech?.unlockedNickPatches || []);

  const supply = await supplyByPatchId();

  return MARKET_PATCH_ORDER.map((id) => {
    const meta = marketPatchMeta(id);
    const base = supply.get(id) || 0;
    const extra = keechDefaultExtra(id, keechUnlocks);
    return {
      ...meta,
      supply: base + extra,
      owned: myUnlocks.has(id),
    };
  });
}

export async function buyMarketPatch(opts: {
  userId: string;
  steamId: string;
  patchId: string;
}): Promise<
  | { ok: true; balance: number; owned: true }
  | { ok: false; error: string }
> {
  if (!isProfilePatchId(opts.patchId)) {
    return { ok: false, error: "patch" };
  }
  const patchId = opts.patchId;
  const price = patchBuyPriceBbc(patchId);

  const user = await prisma.user.findUnique({
    where: { id: opts.userId },
    select: {
      id: true,
      unlockedNickPatches: true,
      nick: true,
      steamId: true,
      nickPatch: true,
    },
  });
  if (!user) return { ok: false, error: "user" };

  const unlocks = user.unlockedNickPatches || [];
  if (unlocks.includes(patchId)) {
    return { ok: false, error: "owned" };
  }

  const bal = await getBbCoinBalance(user.id);
  if (bal < price) return { ok: false, error: "insufficient" };

  const debited = await debitBbCoins({
    userId: user.id,
    amount: price,
    kind: "patch_buy",
    ref: null,
    note: `Покупка нашивки ${patchId} (−${price} BBC)`,
  });
  if (!debited.ok) {
    return {
      ok: false,
      error: debited.error === "insufficient" ? "insufficient" : "debit",
    };
  }

  const nextUnlocks = [...unlocks, patchId];
  await prisma.user.update({
    where: { id: user.id },
    data: { unlockedNickPatches: nextUnlocks },
  });

  if (user.nick && user.steamId) {
    await writeNickPatchesCache().catch(() => null);
  }

  return { ok: true, balance: debited.balance, owned: true };
}

export async function sellMarketPatch(opts: {
  userId: string;
  steamId: string;
  patchId: string;
}): Promise<
  | { ok: true; balance: number; owned: false }
  | { ok: false; error: string }
> {
  if (!isProfilePatchId(opts.patchId)) {
    return { ok: false, error: "patch" };
  }
  const patchId = opts.patchId;
  const price = patchSellPriceBbc(patchId);

  const user = await prisma.user.findUnique({
    where: { id: opts.userId },
    select: {
      id: true,
      unlockedNickPatches: true,
      nickPatch: true,
      nick: true,
      steamId: true,
    },
  });
  if (!user) return { ok: false, error: "user" };

  const unlocks = user.unlockedNickPatches || [];
  if (!unlocks.includes(patchId)) {
    return { ok: false, error: "not_owned" };
  }

  const nextUnlocks = unlocks.filter((x) => x !== patchId);
  const clearEquip = user.nickPatch === patchId;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      unlockedNickPatches: nextUnlocks,
      ...(clearEquip ? { nickPatch: null } : {}),
    },
  });

  const credited = await creditBbCoins({
    userId: user.id,
    amount: price,
    kind: "patch_sell",
    ref: `${patchId}:${Date.now()}`,
    note: `Продажа нашивки ${patchId} (+${price} BBC)`,
  });
  if (!credited.ok) {
    // откат unlocks
    await prisma.user.update({
      where: { id: user.id },
      data: {
        unlockedNickPatches: unlocks,
        ...(clearEquip ? { nickPatch: patchId } : {}),
      },
    });
    return { ok: false, error: "credit" };
  }

  await writeNickPatchesCache().catch(() => null);

  return { ok: true, balance: credited.balance, owned: false };
}
