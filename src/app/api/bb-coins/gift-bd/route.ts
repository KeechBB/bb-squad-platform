import { NextResponse } from "next/server";
import { requireMarketUser } from "@/lib/bbCoinMarketAuth";
import {
  bdPayErrorMessage,
  giftFactionBdToMember,
  getPersonalBdBalance,
} from "@/lib/marketFactionPay";
import {
  hasInfiniteMarketWallet,
  INFINITE_MARKET_BALANCE,
} from "@/lib/marketCharge";
import { personLabel, writeActionLog } from "@/lib/actionLog";
import { prisma } from "@/lib/prisma";
import { BD_MARK } from "@/lib/blueberryDollar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Подарок B$: всегда казна фракции −amount → личный blueberryBalance получателя.
 * ∞-кошелёк не обходит списание казны.
 */
export async function POST(req: Request) {
  const gate = await requireMarketUser();
  if ("error" in gate) return gate.error;
  const { user } = gate;

  const body = (await req.json().catch(() => ({}))) as {
    toUserId?: string;
    amount?: number;
  };
  const toUserId = String(body.toUserId || "").trim();
  const amount = Math.trunc(Number(body.amount) || 0);

  const res = await giftFactionBdToMember({
    actorUserId: user.id,
    actorSteamId: user.steamId,
    toUserId,
    amount,
  });
  if (!res.ok) {
    const status =
      res.error === "insufficient"
        ? 402
        : res.error === "forbidden_seat"
          ? 403
          : 400;
    return NextResponse.json(
      { ok: false, error: res.error, message: bdPayErrorMessage(res.error) },
      { status }
    );
  }

  const [actor, target] = await Promise.all([
    prisma.user.findUnique({
      where: { id: user.id },
      select: { nick: true, steamName: true, steamId: true },
    }),
    prisma.user.findUnique({
      where: { id: res.toUserId },
      select: { nick: true, steamName: true, steamId: true },
    }),
  ]);
  await writeActionLog({
    category: "faction",
    action: "bd_gift",
    message: `${personLabel(actor || user)} подарил ${res.amount.toLocaleString("ru-RU")} ${BD_MARK} → ${personLabel(target || { steamId: res.toUserId })}`,
    actorId: user.id,
    actorNick: personLabel(actor || user),
    targetId: res.toUserId,
    targetNick: personLabel(target || { steamId: res.toUserId }),
    meta: {
      amount: res.amount,
      factionBalance: res.factionBalance,
      recipientPersonalBalance: res.recipientPersonalBalance,
    },
  });

  const infinite = hasInfiniteMarketWallet(user.steamId);
  const personalBdBalance = infinite
    ? INFINITE_MARKET_BALANCE
    : await getPersonalBdBalance(user.id);

  return NextResponse.json({
    ok: true,
    amount: res.amount,
    toUserId: res.toUserId,
    /** Реальный остаток казны после списания (даже если UI у Keech рисует ∞). */
    factionBalance: res.factionBalance,
    personalBdBalance,
    recipientPersonalBalance: res.recipientPersonalBalance,
  });
}
