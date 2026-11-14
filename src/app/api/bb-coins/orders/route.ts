import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bbCoinPackage } from "@/lib/bbCoins";
import { requireMarketUser } from "@/lib/bbCoinMarketAuth";

export const dynamic = "force-dynamic";

/** Создать заказ на покупку BB Coins. Оплата эквайрингом — следующим шагом. */
export async function POST(req: Request) {
  const gate = await requireMarketUser();
  if ("error" in gate) return gate.error;
  const { user } = gate;

  const body = (await req.json().catch(() => ({}))) as {
    packageId?: string;
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

  return NextResponse.json({
    ok: true,
    orderId: order.id,
    status: "PENDING",
    package: pack,
    message:
      "Заказ создан. Оплата картой/СБП появится после подключения кассы (ЮKassa и т.п.).",
  });
}
