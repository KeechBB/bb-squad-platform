import { prisma } from "@/lib/prisma";
import {
  TRANSFER_LOCK_DAYS,
  TRANSFER_MIN_ROSTER,
  estimatePlayerPrice,
  grindAmountFromTrainStats,
} from "@/lib/blueberryDollar";
import { mainKitByUserIds } from "@/lib/squadRoles";

export type ScarcityLevel = "ok" | "thin" | "critical" | "surplus";

export type KitScarcityRow = {
  kitKey: string;
  label: string;
  count: number;
  level: ScarcityLevel;
  hint: string;
};

export const KIT_LABELS: Record<string, string> = {
  sl: "SL",
  medic: "Medic",
  lat: "LAT",
  hat: "HAT",
  at: "AT",
  ar: "AR",
  mg: "MG",
  rifleman: "Rifleman",
  engineer: "Engineer",
  crewman: "Crewman",
  unknown: "Без кита",
};

export function normalizeKit(raw: string | null | undefined): string {
  const s = String(raw || "").trim().toLowerCase();
  if (!s || s === "—") return "unknown";
  if (s === "sl" || s.includes("squad lead") || s === "squadleader") return "sl";
  if (s.includes("medic") || s === "med") return "medic";
  if (s.includes("hat")) return "hat";
  if (s === "lat" || s.includes("light anti")) return "lat";
  if (s === "at" || s.includes("anti-tank") || s.includes("antitank")) return "at";
  if (s === "ar" || s.includes("auto rifle") || s.includes("autorifle")) return "ar";
  if (s === "mg" || s.includes("machine")) return "mg";
  if (s.includes("eng") || s.includes("sapper")) return "engineer";
  if (s.includes("crew")) return "crewman";
  if (s.includes("rifle")) return "rifleman";
  return s.slice(0, 24);
}

function scarcityLevel(count: number, rosterSize: number): ScarcityLevel {
  if (rosterSize < 8) return count <= 1 ? "critical" : "ok";
  const share = count / Math.max(1, rosterSize);
  if (count <= 1 || share < 0.04) return "critical";
  if (count <= 2 || share < 0.08) return "thin";
  if (share > 0.28) return "surplus";
  return "ok";
}

function scarcityHint(level: ScarcityLevel, label: string, count: number): string {
  if (level === "critical")
    return `Критически мало роли ${label} (${count}). Покупка такой роли усилит состав; продажа — риск.`;
  if (level === "thin")
    return `Роли ${label} мало (${count}). Имеет смысл удерживать или докупать.`;
  if (level === "surplus")
    return `Роли ${label} много (${count}). Можно спокойнее выставлять на трансфер.`;
  return `По роли ${label} баланс нормальный (${count}).`;
}

async function keechAuthorId(): Promise<string | null> {
  const bySteam = await prisma.user.findFirst({
    where: { steamId: "76561198028435874" },
    select: { id: true },
  });
  if (bySteam) return bySteam.id;
  const byNick = await prisma.user.findFirst({
    where: { nick: { equals: "Keech", mode: "insensitive" } },
    select: { id: true },
  });
  return byNick?.id ?? null;
}

/** Окно открыто? Учитывает open + даты closedFrom/closedTo. */
export async function getTransferWindowState() {
  const row =
    (await prisma.transferWindowSetting.findUnique({ where: { id: "global" } })) ||
    (await prisma.transferWindowSetting.create({
      data: { id: "global", open: true },
    }));
  const now = new Date();
  let blockedByDates = false;
  if (row.closedFrom && row.closedTo) {
    blockedByDates = now >= row.closedFrom && now <= row.closedTo;
  } else if (row.closedFrom && !row.closedTo) {
    blockedByDates = now >= row.closedFrom;
  }
  const isOpen = row.open && !blockedByDates;
  return {
    id: row.id,
    openFlag: row.open,
    closedFrom: row.closedFrom?.toISOString() ?? null,
    closedTo: row.closedTo?.toISOString() ?? null,
    note: row.note,
    isOpen,
    reason: !row.open
      ? "Окно закрыто администратором."
      : blockedByDates
        ? "Сейчас период закрытия трансферного окна."
        : null,
  };
}

export async function assertTransferWindowOpen() {
  const w = await getTransferWindowState();
  if (!w.isOpen) {
    throw new Error(w.reason || "Трансферное окно закрыто.");
  }
  return w;
}

export async function getFactionRosterCount(factionId: string): Promise<number> {
  return prisma.factionMember.count({ where: { factionId } });
}

export async function assertFactionEligibleForTransfers(factionId: string) {
  const n = await getFactionRosterCount(factionId);
  if (n < TRANSFER_MIN_ROSTER) {
    throw new Error(
      `Для трансферов нужно минимум ${TRANSFER_MIN_ROSTER} человек во фракции (сейчас ${n}).`,
    );
  }
  return n;
}

export async function getUserTransferLock(userId: string) {
  const lock = await prisma.transferLock.findUnique({ where: { userId } });
  if (!lock) return null;
  if (lock.until.getTime() <= Date.now()) {
    await prisma.transferLock.delete({ where: { userId } }).catch(() => null);
    return null;
  }
  return lock;
}

/** Профиль китов фракции + дефицит/профицит. */
export async function buildFactionKitScarcity(factionId: string): Promise<{
  rosterSize: number;
  byKit: KitScarcityRow[];
  byUserId: Record<string, string>;
}> {
  const members = await prisma.factionMember.findMany({
    where: { factionId },
    select: { userId: true },
  });
  const userIds = members.map((m) => m.userId);
  const kitMap = await mainKitByUserIds(userIds);
  const counts = new Map<string, number>();
  const byUserId: Record<string, string> = {};
  for (const uid of userIds) {
    const kit = normalizeKit(kitMap.get(uid) || null);
    byUserId[uid] = kit;
    counts.set(kit, (counts.get(kit) || 0) + 1);
  }
  const rosterSize = userIds.length;
  const byKit: KitScarcityRow[] = [...counts.entries()]
    .map(([kitKey, count]) => {
      const label = KIT_LABELS[kitKey] || kitKey;
      const level = scarcityLevel(count, rosterSize);
      return {
        kitKey,
        label,
        count,
        level,
        hint: scarcityHint(level, label, count),
      };
    })
    .sort((a, b) => {
      const order = { critical: 0, thin: 1, ok: 2, surplus: 3 };
      return order[a.level] - order[b.level] || a.count - b.count;
    });
  return { rosterSize, byKit, byUserId };
}

export function scarcityForDeal(opts: {
  buyerScarcity: KitScarcityRow[];
  sellerScarcity: KitScarcityRow[];
  playerKit: string;
}): {
  buyHints: string[];
  sellHints: string[];
  buyerNeed: ScarcityLevel | null;
  sellerRisk: ScarcityLevel | null;
} {
  const kit = normalizeKit(opts.playerKit);
  const buyerRow = opts.buyerScarcity.find((r) => r.kitKey === kit);
  const sellerRow = opts.sellerScarcity.find((r) => r.kitKey === kit);
  const buyHints: string[] = [];
  const sellHints: string[] = [];
  const buyerNeed = buyerRow?.level ?? null;
  const sellerRisk = sellerRow?.level ?? null;

  if (buyerNeed === "critical" || buyerNeed === "thin") {
    buyHints.push(
      `У вас мало роли ${buyerRow?.label || kit}: покупка закрывает дыру в составе.`,
    );
  } else if (buyerNeed === "surplus") {
    buyHints.push(
      `Роли ${buyerRow?.label || kit} у вас уже много — покупка усилит профицит, не баланс.`,
    );
  } else if (!buyerRow) {
    buyHints.push(`Такой роли (${KIT_LABELS[kit] || kit}) у вас пока нет — усиление состава.`);
  }

  if (sellerRisk === "critical" || sellerRisk === "thin") {
    sellHints.push(
      `Внимание: роли ${sellerRow?.label || kit} у вас и так мало (${sellerRow?.count ?? 0}). Продажа ослабит состав.`,
    );
  } else if (sellerRisk === "surplus") {
    sellHints.push(`Роли ${sellerRow?.label || kit} избыток — продажа логична для баланса казны.`);
  }

  return { buyHints, sellHints, buyerNeed, sellerRisk };
}

async function creditTreasury(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  factionId: string,
  amount: number,
  kind: string,
  sourceKey: string,
  note?: string,
  userId?: string | null,
  matchId?: string | null,
) {
  if (!amount) return;
  await tx.factionLedgerEntry.create({
    data: {
      factionId,
      amount,
      kind,
      sourceKey,
      note: note || null,
      userId: userId || null,
      matchId: matchId || null,
    },
  });
  await tx.faction.update({
    where: { id: factionId },
    data: { blueberryBalance: { increment: amount } },
  });
}

/** Начислить гринд с TRAIN-матча в казны фракций игроков (идемпотентно). */
export async function creditGrindFromCanonMatch(matchId: string): Promise<{ credited: number }> {
  const match = await prisma.canonMatch.findUnique({
    where: { id: matchId },
    include: { players: true },
  });
  if (!match || match.kind !== "TRAIN") return { credited: 0 };

  let credited = 0;
  for (const p of match.players) {
    if (!p.userId) continue;
    const membership = await prisma.factionMember.findFirst({
      where: { userId: p.userId },
      select: { factionId: true },
    });
    if (!membership) continue;
    const amount = grindAmountFromTrainStats({
      kills: p.kills,
      deaths: p.deaths,
      nok: p.nok,
      res: p.res,
      durationSec: match.durationSec,
    });
    if (amount <= 0) continue;
    const sourceKey = `grind:${matchId}:${p.userId}`;
    try {
      await prisma.$transaction(async (tx) => {
        await creditTreasury(
          tx,
          membership.factionId,
          amount,
          "grind",
          sourceKey,
          `Трень ${match.mapName} · ${p.nick}`,
          p.userId,
          matchId,
        );
      });
      credited += 1;
    } catch {
      // unique sourceKey — уже начислено
    }
  }
  return { credited };
}

/** Прогнать гринд по недавним TRAIN. */
export async function creditGrindRecentTrains(limit = 40): Promise<number> {
  const rows = await prisma.canonMatch.findMany({
    where: { kind: "TRAIN" },
    orderBy: { endedAt: "desc" },
    take: limit,
    select: { id: true },
  });
  let n = 0;
  for (const r of rows) {
    const res = await creditGrindFromCanonMatch(r.id);
    n += res.credited;
  }
  return n;
}

export async function loadListingBoard() {
  const listings = await prisma.transferListing.findMany({
    where: { status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    take: 80,
    include: {
      faction: { select: { id: true, name: true, slug: true, logoUrl: true } },
    },
  });
  const userIds = [...new Set(listings.map((l) => l.playerUserId))];
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: {
      id: true,
      nick: true,
      steamName: true,
      avatarUrl: true,
      steamAvatar: true,
    },
  });
  const byId = Object.fromEntries(users.map((u) => [u.id, u]));
  const kits = await mainKitByUserIds(userIds);

  return listings.map((l) => {
    const u = byId[l.playerUserId];
    const kit = kits.get(l.playerUserId) || null;
    const est =
      l.estimatePrice ??
      estimatePlayerPrice({ sri: 50, kitKey: kit });
    return {
      id: l.id,
      askPrice: l.askPrice,
      estimatePrice: est,
      note: l.note,
      createdAt: l.createdAt.toISOString(),
      faction: l.faction,
      player: u
        ? {
            id: u.id,
            nick: u.nick || u.steamName || "—",
            avatarUrl: u.avatarUrl || u.steamAvatar,
            kit,
          }
        : { id: l.playerUserId, nick: "—", avatarUrl: null, kit },
    };
  });
}

type ExecOpts = {
  offerId: string;
  actorUserId: string;
};

/** Принять офер: деньги, свап, локи, мails. */
export async function acceptTransferOffer(opts: ExecOpts) {
  await assertTransferWindowOpen();

  const offer = await prisma.transferOffer.findUnique({
    where: { id: opts.offerId },
    include: {
      listing: { include: { faction: true } },
      fromFaction: true,
    },
  });
  if (!offer || offer.status !== "PENDING") throw new Error("Офер не найден или уже закрыт.");
  if (offer.listing.status !== "ACTIVE") throw new Error("Листинг уже не активен.");

  const listingFactionId = offer.listing.factionId;
  const buyerFactionId = offer.fromFactionId;
  if (listingFactionId === buyerFactionId) throw new Error("Нельзя купить у своей фракции.");

  const actor = await prisma.factionMember.findFirst({
    where: {
      factionId: listingFactionId,
      userId: opts.actorUserId,
      seat: { in: ["LEADER", "DEPUTY"] },
    },
  });
  const keech = await prisma.user.findFirst({
    where: { id: opts.actorUserId, steamId: "76561198028435874" },
    select: { id: true },
  });
  if (!actor && !keech) throw new Error("Принимать оферы может только командир / зам.");

  await assertFactionEligibleForTransfers(listingFactionId);
  await assertFactionEligibleForTransfers(buyerFactionId);

  const playerId = offer.listing.playerUserId;
  const lock = await getUserTransferLock(playerId);
  if (lock) throw new Error("Игрок ещё на трансферном локе.");

  if (offer.swapUserId) {
    const swapLock = await getUserTransferLock(offer.swapUserId);
    if (swapLock) throw new Error("Игрок на обмен ещё на локе.");
    const swapMember = await prisma.factionMember.findFirst({
      where: { factionId: buyerFactionId, userId: offer.swapUserId },
    });
    if (!swapMember) throw new Error("Игрок на обмен не в фракции покупателя.");
  }

  const cash = Math.max(0, offer.cashAmount | 0);
  if ((offer.type === "BUY" || offer.type === "SWAP_CASH") && cash <= 0) {
    throw new Error("Нужна сумма в Черничных Долларах.");
  }

  const until = new Date(Date.now() + TRANSFER_LOCK_DAYS * 86400_000);

  await prisma.$transaction(async (tx) => {
    if (cash > 0) {
      const buyer = await tx.faction.findUnique({ where: { id: buyerFactionId } });
      if (!buyer || buyer.blueberryBalance < cash) {
        throw new Error("Недостаточно средств в казне покупателя.");
      }
      await creditTreasury(
        tx,
        buyerFactionId,
        -cash,
        "transfer_out",
        `xfer_out:${offer.id}`,
        `Оплата трансфера`,
        opts.actorUserId,
        null,
      );
      await creditTreasury(
        tx,
        listingFactionId,
        cash,
        "transfer_in",
        `xfer_in:${offer.id}`,
        `Поступление с трансфера`,
        opts.actorUserId,
        null,
      );
    }

    await tx.factionMember.deleteMany({
      where: { factionId: listingFactionId, userId: playerId },
    });
    const existingBuyer = await tx.factionMember.findFirst({
      where: { userId: playerId },
    });
    if (existingBuyer) {
      await tx.factionMember.delete({ where: { id: existingBuyer.id } });
    }
    await tx.factionMember.create({
      data: {
        factionId: buyerFactionId,
        userId: playerId,
        seat: "MEMBER",
      },
    });

    if (offer.swapUserId) {
      const swapId = offer.swapUserId;
      await tx.factionMember.deleteMany({
        where: { factionId: buyerFactionId, userId: swapId },
      });
      const existSwap = await tx.factionMember.findFirst({ where: { userId: swapId } });
      if (existSwap) await tx.factionMember.delete({ where: { id: existSwap.id } });
      await tx.factionMember.create({
        data: { factionId: listingFactionId, userId: swapId, seat: "MEMBER" },
      });
      await tx.transferLock.upsert({
        where: { userId: swapId },
        create: {
          userId: swapId,
          until,
          lastListingId: offer.listingId,
          note: "лок после обмена",
        },
        update: { until, lastListingId: offer.listingId, note: "лок после обмена" },
      });
    }

    await tx.transferLock.upsert({
      where: { userId: playerId },
      create: {
        userId: playerId,
        until,
        lastListingId: offer.listingId,
        note: "лок после трансфера",
      },
      update: { until, lastListingId: offer.listingId, note: "лок после трансфера" },
    });

    await tx.transferListing.update({
      where: { id: offer.listingId },
      data: { status: "COMPLETED" },
    });
    await tx.transferOffer.update({
      where: { id: offer.id },
      data: { status: "ACCEPTED" },
    });
    await tx.transferOffer.updateMany({
      where: {
        listingId: offer.listingId,
        status: "PENDING",
        id: { not: offer.id },
      },
      data: { status: "DECLINED" },
    });
  });

  await sendTransferMails({
    playerId,
    swapUserId: offer.swapUserId,
    fromFactionName: offer.listing.faction.name,
    toFactionName: offer.fromFaction.name,
    cash,
    type: offer.type,
  }).catch((e) => console.error("transfer mail failed", e));

  return { ok: true as const };
}

async function sendTransferMails(opts: {
  playerId: string;
  swapUserId: string | null;
  fromFactionName: string;
  toFactionName: string;
  cash: number;
  type: string;
}) {
  const authorId = await keechAuthorId();
  if (!authorId) return;

  const bodyMain = [
    `Командование решило: ты переходишь из «${opts.fromFactionName}» в «${opts.toFactionName}».`,
    opts.cash > 0 ? `Сделка: ${opts.cash} Ƅ$ (${opts.type}).` : `Тип сделки: ${opts.type}.`,
    `На ${TRANSFER_LOCK_DAYS} суток стоит трансферный лок — повторно выставить нельзя.`,
    `Это решение штаба. Если что-то непонятно — спроси командира.`,
  ].join("\n\n");

  await prisma.profileMail.create({
    data: {
      title: "Переход во фракцию",
      body: bodyMain,
      senderKind: "transfer",
      senderLabel: "Трансферный штаб",
      tags: ["Трансфер"],
      authorId,
      recipients: { create: [{ userId: opts.playerId }] },
    },
  });

  if (opts.swapUserId) {
    await prisma.profileMail.create({
      data: {
        title: "Обмен между фракциями",
        body: [
          `Ты уходишь в «${opts.fromFactionName}» в рамках обмена с «${opts.toFactionName}».`,
          `Лок ${TRANSFER_LOCK_DAYS} суток. Решение штаба — детали у командира.`,
        ].join("\n\n"),
        senderKind: "transfer",
        senderLabel: "Трансферный штаб",
        tags: ["Трансфер"],
        authorId,
        recipients: { create: [{ userId: opts.swapUserId }] },
      },
    });
  }
}

export { estimatePlayerPrice };
