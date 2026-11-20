import { NextResponse } from "next/server";
import { requireMarketUser } from "@/lib/bbCoinMarketAuth";
import { bdPayErrorMessage, transferPersonalBd } from "@/lib/marketFactionPay";
import { personLabel, writeActionLog } from "@/lib/actionLog";
import { prisma } from "@/lib/prisma";
import { BD_MARK } from "@/lib/blueberryDollar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Личный B$ отправителя → личный B$ игрока той же фракции. */
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

  const res = await transferPersonalBd({
    actorUserId: user.id,
    toUserId,
    amount,
  });
  if (!res.ok) {
    const status = res.error === "insufficient_personal" ? 402 : 400;
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
    action: "bd_transfer",
    message: `${personLabel(actor || user)} перевёл ${res.amount.toLocaleString("ru-RU")} ${BD_MARK} → ${personLabel(target || { steamId: res.toUserId })}`,
    actorId: user.id,
    actorNick: personLabel(actor || user),
    targetId: res.toUserId,
    targetNick: personLabel(target || { steamId: res.toUserId }),
    meta: {
      amount: res.amount,
      personalBdBalance: res.personalBdBalance,
      recipientPersonalBalance: res.recipientPersonalBalance,
    },
  });

  return NextResponse.json({
    ok: true,
    amount: res.amount,
    toUserId: res.toUserId,
    personalBdBalance: res.personalBdBalance,
    recipientPersonalBalance: res.recipientPersonalBalance,
  });
}
