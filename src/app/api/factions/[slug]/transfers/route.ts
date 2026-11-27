import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadFactionView } from "@/lib/factions";
import {
  assertFactionEligibleForTransfers,
  assertTransferWindowOpen,
  buildFactionKitScarcity,
  createTransferListingWithFee,
  creditGrindRecentTrains,
  estimateWithKit,
  getTransferWindowState,
  getUserTransferLock,
  loadGrindMatchSummaries,
  loadGrindPlayerSummaries,
  loadListingBoard,
  loadPlayerPriceStats,
  normalizeKit,
  notifyListedMail,
  notifyWithdrawnMail,
  scarcityForDeal,
} from "@/lib/factionTransfers";
import {
  BD_MARK,
  ESTIMATE_HINT,
  ESTIMATE_LABEL,
  TRANSFER_LIST_FEE_RATIO,
  TRANSFER_MIN_ASK,
  TRANSFER_MIN_ASK_RATIO,
  TRANSFER_MIN_ROSTER,
  listingFeeFromAsk,
  formatBd,
  minAskFromEstimate,
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

  const { getFactionRaceGrace } = await import("@/lib/factionRaceEngine");
  const raceGrace = await getFactionRaceGrace(loaded.view.id);

  const scarcity = await buildFactionKitScarcity(loaded.view.id);
  const scarcityByKit = Object.fromEntries(
    scarcity.byKit.map((r) => [r.kitKey, r.level as "ok" | "thin" | "critical" | "surplus"]),
  );

  const factionId = loaded.view.id;

  const offerInclude = {
    fromFaction: { select: { id: true, name: true, slug: true } },
    listing: {
      select: {
        id: true,
        askPrice: true,
        playerUserId: true,
        status: true,
        faction: { select: { id: true, name: true, slug: true } },
      },
    },
  } as const;

  const [window, board, myListings, allPendingOffers, acceptedDeals, ledger, priceStats, grindMatches, grindPlayers] =
    await Promise.all([
      getTransferWindowState(),
      loadListingBoard({ buyerScarcityByKit: scarcityByKit }),
      prisma.transferListing.findMany({
        where: { factionId, status: "ACTIVE" },
        orderBy: { createdAt: "desc" },
      }),
      /** Все открытые оферы рынка — видят игроки любой фракции. */
      prisma.transferOffer.findMany({
        where: {
          status: "PENDING",
          listing: { status: "ACTIVE" },
        },
        include: offerInclude,
        orderBy: { createdAt: "desc" },
        take: 120,
      }),
      prisma.transferOffer.findMany({
        where: {
          status: "ACCEPTED",
          OR: [{ fromFactionId: factionId }, { listing: { factionId } }],
        },
        include: offerInclude,
        orderBy: { updatedAt: "desc" },
        take: 40,
      }),
      prisma.factionLedgerEntry.findMany({
        where: { factionId },
        orderBy: { createdAt: "desc" },
        take: 800,
      }),
      loadPlayerPriceStats(loaded.view.members.map((m) => m.userId)),
      loadGrindMatchSummaries(),
      loadGrindPlayerSummaries(),
    ]);

  const ledgerUserIds = [
    ...new Set(ledger.map((e) => e.userId).filter(Boolean) as string[]),
  ];
  const ledgerUsers = ledgerUserIds.length
    ? await prisma.user.findMany({
        where: { id: { in: ledgerUserIds } },
        select: { id: true, nick: true, steamId: true, steamName: true },
      })
    : [];
  const ledgerUserById = Object.fromEntries(ledgerUsers.map((u) => [u.id, u]));

  /** Входящие по нашим листингам — для штабной панели. */
  const incomingOffers = allPendingOffers.filter((o) => o.listing.faction.id === factionId);

  const allDealOffers = [...allPendingOffers, ...acceptedDeals];
  const offerPlayerIds = [
    ...new Set(
      allDealOffers.flatMap((o) =>
        [o.listing.playerUserId, o.swapUserId].filter(Boolean) as string[],
      ),
    ),
  ];
  const [offerUsers, offerPriceStats, offerKits] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: offerPlayerIds } },
      select: { id: true, nick: true, steamName: true },
    }),
    loadPlayerPriceStats(offerPlayerIds),
    mainKitByUserIds(offerPlayerIds),
  ]);
  const nickById = Object.fromEntries(
    offerUsers.map((u) => [u.id, u.nick || u.steamName || "—"]),
  );

  /**
   * ТИП относительно своей фракции (путь листингового игрока: продавец → покупатель):
   * ушёл от нас → Продажа; пришёл к нам → Покупка (BUY / SWAP / SWAP_CASH «Игрок + доплата»).
   */
  function dealTypeRuFor(
    o: (typeof allDealOffers)[number],
  ): string {
    const leftUs = o.listing.faction.id === factionId;
    const joinedUs = o.fromFaction.id === factionId;
    if (joinedUs) return "Покупка";
    if (leftUs) return "Продажа";
    // Чужой рынок (не наша сторона): fallback по типу офера.
    if (o.type === "SWAP_CASH") return "Игрок + доплата";
    if (o.type === "SWAP") return "Обмен";
    if (o.type === "BUY") return "Покупка";
    return o.type;
  }
  function dealSideFor(o: (typeof allPendingOffers)[number]): "in" | "out" | "open" {
    if (o.listing.faction.id === factionId) return "in";
    if (o.fromFaction.id === factionId) return "out";
    return "open";
  }
  function dealStatusRu(s: string, side: "in" | "out" | "open" | "done") {
    if (side === "done" || s === "ACCEPTED") return "Успешно";
    if (s === "PENDING" && side === "in") return "К нам";
    if (s === "PENDING" && side === "out") return "От нас";
    if (s === "PENDING" && side === "open") return "Открыт";
    return s;
  }
  function mapDealRow(
    o: (typeof allDealOffers)[number],
    side: "in" | "out" | "open" | "done",
  ) {
    return {
      id: o.id,
      side,
      status: o.status,
      statusLabel: dealStatusRu(o.status, side),
      type: o.type,
      typeLabel: dealTypeRuFor(o),
      cashAmount: o.cashAmount,
      askPrice: o.listing.askPrice,
      message: o.message,
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString(),
      // «От / Кому» = путь игрока: листер (откуда ушёл) → офер (куда купили).
      // o.fromFaction = покупатель; o.listing.faction = продавец.
      fromFaction: o.listing.faction,
      toFaction: o.fromFaction,
      playerNick: nickById[o.listing.playerUserId] || "—",
      playerUserId: o.listing.playerUserId,
      swapNick: o.swapUserId ? nickById[o.swapUserId] || "—" : null,
      swapUserId: o.swapUserId,
    };
  }
  function offerPlayerCard(userId: string | null | undefined) {
    if (!userId) return null;
    const kit = offerKits.get(userId) || null;
    const st = offerPriceStats.get(userId);
    return {
      userId,
      nick: nickById[userId] || "—",
      kit,
      estimate: estimateWithKit(st, kit),
      stats: st
        ? {
            trainDays14: st.trainDays14,
            matches30: st.matches30,
            kills30: st.kills30,
            deaths30: st.deaths30,
            res30: st.res30,
            nok30: st.nok30,
            kd:
              st.deaths30 > 0
                ? Math.round((st.kills30 / st.deaths30) * 100) / 100
                : st.kills30,
            lastSeenDaysAgo: st.lastSeenDaysAgo,
            grindBroughtBd: st.grindBroughtBd || 0,
            grindAvgPerMatchBd: st.grindAvgPerMatchBd || 0,
          }
        : null,
    };
  }

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
            grindBroughtBd: st.grindBroughtBd || 0,
            grindAvgPerMatchBd: st.grindAvgPerMatchBd || 0,
          }
        : null,
    };
  });

  return NextResponse.json({
    mark: BD_MARK,
    minRoster: TRANSFER_MIN_ROSTER,
    minAsk: TRANSFER_MIN_ASK,
    minAskRatio: TRANSFER_MIN_ASK_RATIO,
    listFeeRatio: TRANSFER_LIST_FEE_RATIO,
    estimateLabel: ESTIMATE_LABEL,
    estimateHint: ESTIMATE_HINT,
    rosterSize: scarcity.rosterSize,
    eligible: scarcity.rosterSize >= TRANSFER_MIN_ROSTER,
    treasury: loaded.view.blueberryBalance,
    treasuryLabel: formatBd(loaded.view.blueberryBalance),
    canManage: loaded.view.canManage || loaded.view.keech,
    raceGrace,
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
      listedPlayer: offerPlayerCard(o.listing.playerUserId),
      swapPlayer: offerPlayerCard(o.swapUserId),
    })),
    listable,
    ledger: ledger.map((e) => {
      const u = e.userId ? ledgerUserById[e.userId] : null;
      return {
        id: e.id,
        amount: e.amount,
        kind: e.kind,
        note: e.note,
        createdAt: e.createdAt.toISOString(),
        label: `${e.amount > 0 ? "+" : ""}${e.amount} ${BD_MARK}`,
        userId: e.userId || null,
        nick: (u?.nick || u?.steamName || null) as string | null,
        steamId: (u?.steamId || null) as string | null,
      };
    }),
    grindMatches,
    grindPlayers,
    /**
     * «Сейчас открыты» = весь рынок: активные лоты на доске + pending-оферы.
     * Успешные сделки — только своей фракции.
     */
    deals: {
      pending: [
        ...enrichedBoard.map((row) => ({
          id: `listing:${row.id}`,
          side: row.isOwn ? ("out" as const) : ("open" as const),
          status: "LISTED",
          statusLabel: row.isOwn ? "Наш лот" : "На доске",
          type: "LISTING",
          typeLabel: "Выставлен",
          cashAmount: row.askPrice,
          askPrice: row.askPrice,
          message: row.note,
          createdAt: row.createdAt,
          updatedAt: row.createdAt,
          fromFaction: row.faction,
          toFaction: { id: "market", name: "рынок", slug: "market" },
          playerNick: row.player.nick,
          playerUserId: row.player.id,
          swapNick: null as string | null,
          swapUserId: null as string | null,
        })),
        ...allPendingOffers.map((o) => mapDealRow(o, dealSideFor(o))),
      ].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      closed: acceptedDeals.map((o) => mapDealRow(o, "done")),
    },
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
      const floor = minAskFromEstimate(estimate);
      if (askPrice < floor) {
        return NextResponse.json(
          {
            error: `Цена не ниже 80% рыночной оценки (от ${floor.toLocaleString("ru-RU")} B$, оценка ${estimate.toLocaleString("ru-RU")} B$)`,
            estimate,
            minAsk: floor,
          },
          { status: 400 },
        );
      }
      const sellHints = scarcityForDeal({
        buyerScarcity: [],
        sellerScarcity: scarcity.byKit,
        playerKit: kit,
      }).sellHints;

      const note = String(body?.note || "").trim() || null;
      const created = await createTransferListingWithFee({
        factionId: loaded.view.id,
        playerUserId: userId,
        listedByUserId: loaded.me.id,
        askPrice,
        estimatePrice: estimate,
        note,
      });
      if (!created.ok) {
        const fee = created.fee || listingFeeFromAsk(askPrice);
        return NextResponse.json(
          {
            error: `Не хватает ${fee.toLocaleString("ru-RU")} ${BD_MARK} в казне на комиссию 1% за лот (сейчас ${created.treasury.toLocaleString("ru-RU")} ${BD_MARK})`,
            fee,
            treasury: created.treasury,
          },
          { status: 400 },
        );
      }
      await notifyListedMail({
        playerUserId: userId,
        factionName: loaded.view.name,
        askPrice,
        estimatePrice: estimate,
        listingId: created.listingId,
        note,
      }).catch((e) => console.error("listed mail", e));
      return NextResponse.json({
        ok: true,
        listingId: created.listingId,
        sellHints,
        estimate,
        fee: created.fee,
        treasury: created.treasury,
      });
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
        await notifyWithdrawnMail({
          playerUserId: listing.playerUserId,
          factionName: loaded.view.name,
          listingId: listing.id,
          askPrice: listing.askPrice,
        }).catch((e) => console.error("withdrawn mail", e));
        return NextResponse.json({ ok: true });
      }
      await assertTransferWindowOpen();
      const askPrice = Math.round(Number(body?.askPrice) || 0);
      const kits = await mainKitByUserIds([listing.playerUserId]);
      const kit = kits.get(listing.playerUserId) || "rifleman";
      const scarcity = await buildFactionKitScarcity(loaded.view.id);
      const kitNorm = normalizeKit(kit);
      const sellerLevel = scarcity.byKit.find((r) => r.kitKey === kitNorm)?.level;
      const statsMap = await loadPlayerPriceStats([listing.playerUserId]);
      const estimate = estimateWithKit(statsMap.get(listing.playerUserId), kit, sellerLevel);
      const floor = minAskFromEstimate(estimate);
      if (askPrice < floor) {
        return NextResponse.json(
          {
            error: `Цена не ниже 80% рыночной оценки (от ${floor.toLocaleString("ru-RU")} B$)`,
            estimate,
            minAsk: floor,
          },
          { status: 400 },
        );
      }
      await prisma.$transaction([
        prisma.transferListing.update({
          where: { id: listing.id },
          data: { askPrice, estimatePrice: estimate },
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
      return NextResponse.json({ ok: true, estimate });
    }

    return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Ошибка" },
      { status: 400 },
    );
  }
}
