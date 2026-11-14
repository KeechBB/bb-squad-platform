/**
 * Каталог и сделки центробанка нашивок за BB Coins.
 * Продажа снимает id из unlockedNickPatches — нашивка пропадает из инвентаря
 * (в т.ч. у Keech: без creator-bypass для market-id).
 */
import { prisma } from "@/lib/prisma";
import { isProfilePatchId, type ProfilePatchId } from "@/lib/profilePatches";
import { creditBbCoins, debitBbCoins, getBbCoinBalance } from "@/lib/bbCoins";
import {
  marketPatchMeta,
  patchBuyPriceBbc,
  patchSellPriceBbc,
  type MarketPatchCard,
} from "@/lib/bbCoinPatchPrices";
import { MARKET_PATCH_ORDER } from "@/lib/marketPatchIds";
import { SITE_CREATOR_STEAM_ID } from "@/lib/profileBg";
import { isBuiltinSuperAdmin } from "@/lib/admin";
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

/**
 * L15 раньше давали через alias pb1-* — переносим в явный bp-l15-keech,
 * иначе после продажи через alias нашивка «возвращалась».
 */
async function ensureL15AliasMaterialized(userId: string, unlocks: string[]) {
  const set = new Set(unlocks);
  if (set.has("bp-l15-keech")) return unlocks;
  if (!set.has("pb1-gold-nick") && !set.has("pb1-profile-customize")) {
    return unlocks;
  }
  const next = [...unlocks, "bp-l15-keech"];
  await prisma.user.update({
    where: { id: userId },
    data: { unlockedNickPatches: next },
  });
  return next;
}

/** Маркер: стартовый инвентарь Keech уже выдан (продажа не должна засеивать снова). */
const KEECH_MARKET_SEED_FLAG = "__market_keech_seed_v1";

/**
 * Keech: один раз засеять каталог в инвентарь.
 * После продажи id снимается и больше не возвращается (ни gate, ни повторный seed).
 */
export async function ensureKeechMarketStarterInventory(steamId: string) {
  if (!isBuiltinSuperAdmin(steamId) && steamId !== SITE_CREATOR_STEAM_ID) {
    return;
  }
  const u = await prisma.user.findUnique({
    where: { steamId },
    select: { id: true, unlockedNickPatches: true },
  });
  if (!u) return;
  const list = u.unlockedNickPatches || [];
  if (list.includes(KEECH_MARKET_SEED_FLAG)) return;

  const set = new Set(list);
  for (const id of MARKET_PATCH_ORDER) set.add(id);
  set.add(KEECH_MARKET_SEED_FLAG);
  await prisma.user.update({
    where: { id: u.id },
    data: { unlockedNickPatches: [...set] },
  });
}

export async function loadMarketPatchCatalog(opts: {
  userId: string;
  steamId: string;
}): Promise<MarketPatchCard[]> {
  await ensureKeechMarketStarterInventory(opts.steamId);

  let me = await prisma.user.findUnique({
    where: { id: opts.userId },
    select: { id: true, unlockedNickPatches: true },
  });
  if (me) {
    const next = await ensureL15AliasMaterialized(
      me.id,
      me.unlockedNickPatches || []
    );
    me = { ...me, unlockedNickPatches: next };
  }
  const myUnlocks = new Set(me?.unlockedNickPatches || []);

  const supply = await supplyByPatchId();

  return MARKET_PATCH_ORDER.map((id) => {
    const meta = marketPatchMeta(id);
    return {
      ...meta,
      supply: supply.get(id) || 0,
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

  let unlocks = user.unlockedNickPatches || [];
  unlocks = await ensureL15AliasMaterialized(user.id, unlocks);

  if (!unlocks.includes(patchId)) {
    return { ok: false, error: "not_owned" };
  }

  const nextUnlocks = unlocks.filter((x) => x !== patchId);
  const clearEquip = user.nickPatch === patchId;

  // Сначала списываем из инвентаря — нашивка сразу пропадает (даже у Keech).
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
