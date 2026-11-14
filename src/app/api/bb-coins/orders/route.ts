import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { bbCoinPackage, creditBbCoins } from "@/lib/bbCoins";
import { isSuperAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

/** Создать заказ на покупку BB Coins. Оплата эквайрингом — следующим шагом. */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId) {
    return NextResponse.json({ ok: false, error: "auth" }, { status: 401 });
  }
  const user = await prisma.user.findUnique({
    where: { steamId: session.user.steamId },
    select: { id: true, profileComplete: true, steamId: true },
  });
  if (!user?.profileComplete) {
    return NextResponse.json({ ok: false, error: "profile" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    packageId?: string;
    /** Только супер-админ: сразу зачислить (тест без эквайринга) */
    testPay?: boolean;
  };
  const pack = bbCoinPackage(String(body.packageId || ""));
  if (!pack) {
    return NextResponse.json({ ok: false, error: "package" }, { status: 400 });
  }

  const order = await prisma.bbCoinOrder.create({
    data: {
      userId: user.id,
      packageId: pack.id,
      rubles: pack.rubles,
      coins: pack.coins,
      status: "PENDING",
      provider: "manual",
    },
  });

  const testPay =
    Boolean(body.testPay) && (await isSuperAdmin(user.steamId));
  if (testPay) {
    const paid = await markOrderPaid(order.id, user.id, pack.coins);
    return NextResponse.json({
      ok: true,
      orderId: order.id,
      status: "PAID",
      balance: paid.balance,
      testPay: true,
      message: "Тестовая оплата (только капитан). Эквайринг подключим отдельно.",
    });
  }

  return NextResponse.json({
    ok: true,
    orderId: order.id,
    status: "PENDING",
    package: pack,
    message:
      "Заказ создан. Оплата картой/СБП появится после подключения кассы (ЮKassa и т.п.). Пока зачисление — через капитана.",
  });
}

async function markOrderPaid(orderId: string, userId: string, coins: number) {
  await prisma.bbCoinOrder.update({
    where: { id: orderId },
    data: { status: "PAID", paidAt: new Date(), provider: "manual-test" },
  });
  const res = await creditBbCoins({
    userId,
    amount: coins,
    kind: "purchase",
    ref: orderId,
    note: `Покупка пакета (${coins} BB Coins)`,
  });
  return { balance: res.ok ? res.balance : await prisma.user.findUnique({ where: { id: userId } }).then((u) => u?.bbCoins || 0) };
}
