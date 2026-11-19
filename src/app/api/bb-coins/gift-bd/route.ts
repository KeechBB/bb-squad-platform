import { NextResponse } from "next/server";
import { requireMarketUser } from "@/lib/bbCoinMarketAuth";
import {
  bdPayErrorMessage,
  getFactionPayCtx,
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

  const infinite = hasInfiniteMarketWallet(user.steamId);
  if (infinite) {
    // Keech ∞: зачисляем получателю без списания казны.
    if (amount < 1) {
      return NextResponse.json(
        { ok: false, error: "amount", message: bdPayErrorMessage("amount") },
        { status: 400 }
      );
    }
    if (!toUserId || toUserId === user.id) {
      const err = toUserId === user.id ? "gift_self" : "gift_required";
      return NextResponse.json(
        { ok: false, error: err, message: bdPayErrorMessage(err) },
        { status: 400 }
      );
    }
    const targetMem = await prisma.factionMember.findUnique({
      where: { userId: toUserId },
      select: { factionId: true },
    });
    const actorCtx = await getFactionPayCtx(user.id, user.steamId);
    if (
      actorCtx &&
      targetMem &&
      targetMem.factionId !== actorCtx.factionId
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "gift_not_member",
          message: bdPayErrorMessage("gift_not_member"),
        },
        { status: 400 }
      );
    }
    const target = await prisma.user.update({
      where: { id: toUserId },
      data: { blueberryBalance: { increment: amount } },
      select: {
        id: true,
        nick: true,
        steamName: true,
        steamId: true,
        blueberryBalance: true,
      },
    });
    const actor = await prisma.user.findUnique({
      where: { id: user.id },
      select: { nick: true, steamName: true, steamId: true },
    });
    await writeActionLog({
      category: "faction",
      action: "bd_gift",
      message: `${personLabel(actor || user)} подарил ${amount.toLocaleString("ru-RU")} ${BD_MARK} → ${personLabel(target)} (∞)`,
      actorId: user.id,
      actorNick: personLabel(actor || user),
      targetId: target.id,
      targetNick: personLabel(target),
      meta: { amount, infinite: true },
    });
    return NextResponse.json({
      ok: true,
      amount,
      toUserId: target.id,
      factionBalance: INFINITE_MARKET_BALANCE,
      personalBdBalance: INFINITE_MARKET_BALANCE,
      recipientPersonalBalance: Math.max(0, target.blueberryBalance || 0),
    });
  }

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

  const personalBdBalance = await getPersonalBdBalance(user.id);
  return NextResponse.json({
    ok: true,
    amount: res.amount,
    toUserId: res.toUserId,
    factionBalance: res.factionBalance,
    personalBdBalance,
    recipientPersonalBalance: res.recipientPersonalBalance,
  });
}
