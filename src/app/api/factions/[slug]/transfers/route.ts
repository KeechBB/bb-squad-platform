import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadFactionView } from "@/lib/factions";
import {
  assertFactionEligibleForTransfers,
  assertTransferWindowOpen,
  buildFactionKitScarcity,
  creditGrindRecentTrains,
  estimateWithKit,
  getTransferWindowState,
  getUserTransferLock,
  loadListingBoard,
  loadPlayerPriceStats,
  normalizeKit,
  scarcityForDeal,
} from "@/lib/factionTransfers";
import {
  BD_MARK,
  ESTIMATE_HINT,
  ESTIMATE_LABEL,
  TRANSFER_MIN_ASK,
  TRANSFER_MIN_ROSTER,
  formatBd,
} from "@/lib/blueberryDollar";
import { mainKitByUserIds } from "@/lib/squadRoles";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const session = await getServerSession(authOptions);
  const loaded = await loadFactionView(decodeURIComponent(slug), session?.user?.steamId ?? null);
  if (loaded.error || !loaded.view) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 404 });
  }

  // тихий догон гринда с недавних трён (идемпотентно)
  void creditGrindRecentTrains(12).catch(() => null);

  const scarcity = await buildFactionKitScarcity(loaded.view.id);
  const scarcityByKit = Object.fromEntries(
    scarcity.byKit.map((r) => [r.kitKey, r.level as "ok" | "thin" | "critical" | "surplus"]),
  );

  const [window, board, myListings, incomingOffers, ledger, priceStats] = await Promise.all([
    getTransferWindowState(),
    loadListingBoard({ buyerScarcityByKit: scarcityByKit }),
    prisma.transferListing.findMany({
      where: { factionId: loaded.view.id, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
    }),
    prisma.transferOffer.findMany({
      where: {
        status: "PENDING",
        listing: { factionId: loaded.view.id, status: "ACTIVE" },
      },
      include: {
        fromFaction: { select: { id: true, name: true, slug: true } },
        listing: {
          select: {
            id: true,
            askPrice: true,
            playerUserId: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 40,
    }),
    prisma.factionLedgerEntry.findMany({
      where: { factionId: loaded.view.id },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    loadPlayerPriceStats(loaded.view.members.map((m) => m.userId)),
  ]);

  const offerPlayerIds = [
    ...new Set(incomingOffers.map((o) => o.listing.playerUserId)),
  ];
  const offerUsers = await prisma.user.findMany({
    where: { id: { in: offerPlayerIds } },
    select: { id: true, nick: true, steamName: true },
  });
  const nickById = Object.fromEntries(
    offerUsers.map((u) => [u.id, u.nick || u.steamName || "—"]),
  );

  // scarcity hints for board vs our faction
  const enrichedBoard = board.map((row) => {
    const kit = normalizeKit(row.player.kit);
    const hints = scarcityForDeal({
      buyerScarcity: scarcity.byKit,
      sellerScarcity: [],
      playerKit: kit,
    });
    return {
      ...row,
      scarcityBuyHints: hints.buyHints,
      buyerNeed: hints.buyerNeed,
      isOwn: row.faction.id === loaded.view!.id,
    };
  });

  const memberKits = scarcity.byUserId;
  const listable = loaded.view.members.map((m) => {
    const kit = memberKits[m.userId] || normalizeKit(m.mainKit);
    const sellHints = scarcityForDeal({
      buyerScarcity: [],
      sellerScarcity: scarcity.byKit,
      playerKit: kit,
    }).sellHints;
    const estimate = estimateWithKit(priceStats.get(m.userId), kit, scarcityByKit[kit]);
    const st = priceStats.get(m.userId);
    return {
      userId: m.userId,
      nick: m.nick,
      seat: m.seat,
      kit,
      estimate,
      sellHints,
      stats: st
        ? {
            trainDays14: st.trainDays14,
            matches30: st.matches30,
            kills30: st.kills30,
            deaths30: st.deaths30,
            res30: st.res30,
            kd:
              st.deaths30 > 0
                ? Math.round((st.kills30 / st.deaths30) * 100) / 100
                : st.kills30,
          }
        : null,
    };
  });

  return NextResponse.json({
    mark: BD_MARK,
    minRoster: TRANSFER_MIN_ROSTER,
    minAsk: TRANSFER_MIN_ASK,
    estimateLabel: ESTIMATE_LABEL,
    estimateHint: ESTIMATE_HINT,
    rosterSize: scarcity.rosterSize,
    eligible: scarcity.rosterSize >= TRANSFER_MIN_ROSTER,
    treasury: loaded.view.blueberryBalance,
    treasuryLabel: formatBd(loaded.view.blueberryBalance),
    canManage: loaded.view.canManage || loaded.view.keech,
    window,
    scarcity: scarcity.byKit,
    board: enrichedBoard,
    myListings: myListings.map((l) => ({
      id: l.id,
      playerUserId: l.playerUserId,
      askPrice: l.askPrice,
      estimatePrice: l.estimatePrice,
      note: l.note,
      createdAt: l.createdAt.toISOString(),
      sellHints: scarcityForDeal({
        buyerScarcity: [],
        sellerScarcity: scarcity.byKit,
        playerKit: memberKits[l.playerUserId] || "unknown",
      }).sellHints,
    })),
    incomingOffers: incomingOffers.map((o) => ({
      id: o.id,
      type: o.type,
      cashAmount: o.cashAmount,
      swapUserId: o.swapUserId,
      message: o.message,
      createdAt: o.createdAt.toISOString(),
      fromFaction: o.fromFaction,
      listingId: o.listing.id,
      askPrice: o.listing.askPrice,
      playerNick: nickById[o.listing.playerUserId] || "—",
      playerUserId: o.listing.playerUserId,
    })),
    listable,
    ledger: ledger.map((e) => ({
      id: e.id,
      amount: e.amount,
      kind: e.kind,
      note: e.note,
      createdAt: e.createdAt.toISOString(),
      label: `${e.amount > 0 ? "+" : ""}${e.amount} ${BD_MARK}`,
    })),
  });
}

/** Выставить игрока / снять / сменить цену */
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
    action?: "list" | "withdraw" | "reprice";
    userId?: string;
    listingId?: string;
    askPrice?: number;
    note?: string;
  } | null;

  const action = body?.action || "list";

  try {
    if (action === "list") {
      await assertTransferWindowOpen();
      await assertFactionEligibleForTransfers(loaded.view.id);
      const userId = String(body?.userId || "").trim();
      const askPrice = Math.round(Number(body?.askPrice) || 0);
      if (!userId || askPrice < TRANSFER_MIN_ASK) {
        return NextResponse.json(
          { error: `Укажи игрока и цену (от ${TRANSFER_MIN_ASK.toLocaleString("ru-RU")} B$)` },
          { status: 400 },
        );
      }
      const member = loaded.view.members.find((m) => m.userId === userId);
      if (!member) {
        return NextResponse.json({ error: "Игрок не в этой фракции" }, { status: 400 });
      }
      if (member.seat === "LEADER") {
        return NextResponse.json({ error: "Главу фракции выставлять нельзя" }, { status: 400 });
      }
      const lock = await getUserTransferLock(userId);
      if (lock) {
        return NextResponse.json(
          { error: `Игрок на локе до ${lock.until.toISOString().slice(0, 10)}` },
          { status: 400 },
        );
      }
      const active = await prisma.transferListing.findFirst({
        where: { playerUserId: userId, status: "ACTIVE" },
      });
      if (active) {
        return NextResponse.json({ error: "Игрок уже на доске" }, { status: 409 });
      }

      const kits = await mainKitByUserIds([userId]);
      const kit = kits.get(userId) || member.mainKit;
      const scarcity = await buildFactionKitScarcity(loaded.view.id);
      const kitNorm = normalizeKit(kit);
      const sellerLevel = scarcity.byKit.find((r) => r.kitKey === kitNorm)?.level;
      const [statsMap] = await Promise.all([loadPlayerPriceStats([userId])]);
      const estimate = estimateWithKit(statsMap.get(userId), kit, sellerLevel);
      const sellHints = scarcityForDeal({
        buyerScarcity: [],
        sellerScarcity: scarcity.byKit,
        playerKit: kit,
      }).sellHints;

      const listing = await prisma.transferListing.create({
        data: {
          factionId: loaded.view.id,
          playerUserId: userId,
          listedByUserId: loaded.me.id,
          askPrice,
          estimatePrice: estimate,
          note: String(body?.note || "").trim() || null,
          priceEvents: {
            create: {
              askPrice,
              actorId: loaded.me.id,
              note: "первичная цена",
            },
          },
        },
      });
      return NextResponse.json({ ok: true, listingId: listing.id, sellHints, estimate });
    }

    if (action === "withdraw" || action === "reprice") {
      const listingId = String(body?.listingId || "").trim();
      const listing = await prisma.transferListing.findFirst({
        where: { id: listingId, factionId: loaded.view.id, status: "ACTIVE" },
      });
      if (!listing) {
        return NextResponse.json({ error: "Листинг не найден" }, { status: 404 });
      }
      if (action === "withdraw") {
        await prisma.transferListing.update({
          where: { id: listing.id },
          data: { status: "WITHDRAWN" },
        });
        await prisma.transferOffer.updateMany({
          where: { listingId: listing.id, status: "PENDING" },
          data: { status: "CANCELLED" },
        });
        return NextResponse.json({ ok: true });
      }
      await assertTransferWindowOpen();
      const askPrice = Math.round(Number(body?.askPrice) || 0);
      if (askPrice < TRANSFER_MIN_ASK) {
        return NextResponse.json(
          { error: `Цена от ${TRANSFER_MIN_ASK.toLocaleString("ru-RU")} B$` },
          { status: 400 },
        );
      }
      await prisma.$transaction([
        prisma.transferListing.update({
          where: { id: listing.id },
          data: { askPrice },
        }),
        prisma.transferPriceEvent.create({
          data: {
            listingId: listing.id,
            askPrice,
            actorId: loaded.me.id,
            note: "переоценка",
          },
        }),
      ]);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Ошибка" },
      { status: 400 },
    );
  }
}
