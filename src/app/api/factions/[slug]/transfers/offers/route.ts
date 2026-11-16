import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadFactionView } from "@/lib/factions";
import {
  acceptTransferOffer,
  assertFactionEligibleForTransfers,
  assertTransferWindowOpen,
  buildFactionKitScarcity,
  notifyOfferMail,
  scarcityForDeal,
} from "@/lib/factionTransfers";
import { mainKitByUserIds } from "@/lib/squadRoles";
import { TRANSFER_MIN_ASK } from "@/lib/blueberryDollar";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ slug: string }> };

/** Создать офер (BUY / SWAP / SWAP_CASH) от своей фракции на чужой листинг */
export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const session = await getServerSession(authOptions);
  const loaded = await loadFactionView(decodeURIComponent(slug), session?.user?.steamId ?? null);
  if (loaded.error || !loaded.view || !loaded.me) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 404 });
  }
  if (!loaded.view.canManage && !loaded.view.keech) {
    return NextResponse.json({ error: "Только командир / зам" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    listingId?: string;
    type?: "BUY" | "SWAP" | "SWAP_CASH";
    cashAmount?: number;
    swapUserId?: string | null;
    message?: string;
  } | null;

  try {
    await assertTransferWindowOpen();
    await assertFactionEligibleForTransfers(loaded.view.id);

    const listingId = String(body?.listingId || "").trim();
    const type = body?.type || "BUY";
    const listing = await prisma.transferListing.findFirst({
      where: { id: listingId, status: "ACTIVE" },
      include: { faction: { select: { id: true, name: true } } },
    });
    if (!listing) {
      return NextResponse.json({ error: "Листинг не найден" }, { status: 404 });
    }
    if (listing.factionId === loaded.view.id) {
      return NextResponse.json({ error: "Это ваш листинг" }, { status: 400 });
    }

    const cashAmount = Math.max(0, Math.round(Number(body?.cashAmount) || 0));
    const swapUserId = body?.swapUserId ? String(body.swapUserId).trim() : null;

    if (type === "BUY" && cashAmount < TRANSFER_MIN_ASK) {
      return NextResponse.json(
        { error: `Сумма от ${TRANSFER_MIN_ASK.toLocaleString("ru-RU")} B$` },
        { status: 400 },
      );
    }
    if ((type === "SWAP" || type === "SWAP_CASH") && !swapUserId) {
      return NextResponse.json({ error: "Укажи игрока на обмен" }, { status: 400 });
    }
    if (type === "SWAP_CASH" && cashAmount < 1) {
      return NextResponse.json({ error: "Укажи доплату в B$" }, { status: 400 });
    }
    if (cashAmount > 0 && loaded.view.blueberryBalance < cashAmount) {
      return NextResponse.json({ error: "Недостаточно в казне" }, { status: 400 });
    }
    if (swapUserId) {
      const swap = loaded.view.members.find((m) => m.userId === swapUserId);
      if (!swap) {
        return NextResponse.json({ error: "Игрок на обмен не в вашей фракции" }, { status: 400 });
      }
      if (swap.seat === "LEADER") {
        return NextResponse.json({ error: "Главу менять нельзя" }, { status: 400 });
      }
    }

    const kits = await mainKitByUserIds([listing.playerUserId]);
    const kit = kits.get(listing.playerUserId) || "unknown";
    const [buyerScar, sellerScar] = await Promise.all([
      buildFactionKitScarcity(loaded.view.id),
      buildFactionKitScarcity(listing.factionId),
    ]);
    const hints = scarcityForDeal({
      buyerScarcity: buyerScar.byKit,
      sellerScarcity: sellerScar.byKit,
      playerKit: kit,
    });

    const message = String(body?.message || "").trim() || null;
    const offer = await prisma.transferOffer.create({
      data: {
        listingId: listing.id,
        fromFactionId: loaded.view.id,
        createdByUserId: loaded.me.id,
        type,
        cashAmount: type === "SWAP" ? 0 : cashAmount,
        swapUserId: type === "BUY" ? null : swapUserId,
        message,
      },
    });

    await notifyOfferMail({
      listedPlayerId: listing.playerUserId,
      listedFactionName: listing.faction.name,
      fromFactionName: loaded.view.name,
      type,
      cashAmount: type === "SWAP" ? 0 : cashAmount,
      askPrice: listing.askPrice,
      offerId: offer.id,
      swapUserId: type === "BUY" ? null : swapUserId,
      message,
    }).catch((e) => console.error("offer mail", e));

    return NextResponse.json({
      ok: true,
      offerId: offer.id,
      scarcityHints: hints,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Ошибка" },
      { status: 400 },
    );
  }
}

/** Принять / отклонить входящий офер */
export async function PATCH(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const session = await getServerSession(authOptions);
  const loaded = await loadFactionView(decodeURIComponent(slug), session?.user?.steamId ?? null);
  if (loaded.error || !loaded.view || !loaded.me) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 404 });
  }
  if (!loaded.view.canManage && !loaded.view.keech) {
    return NextResponse.json({ error: "Только командир / зам" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    offerId?: string;
    action?: "accept" | "decline";
  } | null;

  const offerId = String(body?.offerId || "").trim();
  const action = body?.action || "decline";

  try {
    if (action === "accept") {
      await acceptTransferOffer({
        offerId,
        actorUserId: loaded.me.id,
      });
      return NextResponse.json({ ok: true });
    }

    const offer = await prisma.transferOffer.findFirst({
      where: {
        id: offerId,
        status: "PENDING",
        listing: { factionId: loaded.view.id },
      },
    });
    if (!offer) {
      return NextResponse.json({ error: "Офер не найден" }, { status: 404 });
    }
    await prisma.transferOffer.update({
      where: { id: offer.id },
      data: { status: "DECLINED" },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Ошибка" },
      { status: 400 },
    );
  }
}
