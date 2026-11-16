import { prisma } from "@/lib/prisma";
import {
  BD_MARK,
  TRANSFER_LOCK_DAYS,
  TRANSFER_MIN_ROSTER,
  estimatePlayerPrice,
  grindAmountFromTrainStats,
  type PlayerPriceStats,
  type ScarcityForPrice,
} from "@/lib/blueberryDollar";
import { mainKitByUserIds } from "@/lib/squadRoles";
import { isTrainingServerKey, TRAINING_SERVER_KEYS } from "@/lib/squadServers";
import { profileHistoryKey } from "@/lib/nickCollisions";
import { nickCompact } from "@/lib/nickIdentity";

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
  if (byNick) return byNick.id;
  const superAdmin = await prisma.user.findFirst({
    where: { role: "SUPER_ADMIN" },
    select: { id: true },
  });
  return superAdmin?.id ?? null;
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

/** Начислить гринд с TRAIN на TR1–TR5 (идемпотентно). Паблик/прочее — нет. */
export async function creditGrindFromCanonMatch(matchId: string): Promise<{ credited: number }> {
  const match = await prisma.canonMatch.findUnique({
    where: { id: matchId },
    include: { players: true },
  });
  if (!match || match.kind !== "TRAIN") return { credited: 0 };
  if (!isTrainingServerKey(match.serverKey)) return { credited: 0 };
  // Только залитые в статистику тренировок (календарь/профиль), не сырой коллектор.
  if (!match.legacyId || !match.publishedAt) return { credited: 0 };
  const inTrainStats = await prisma.profileMatchLine.findFirst({
    where: { kind: "train", matchId: match.legacyId },
    select: { id: true },
  });
  if (!inTrainStats) return { credited: 0 };

  // Canon players often come without userId — резолвим по нику/steamName.
  const needResolve = match.players.some((p) => !p.userId);
  const nickToUserId = new Map<string, string>();
  if (needResolve) {
    const users = await prisma.user.findMany({
      where: { OR: [{ nick: { not: null } }, { steamName: { not: null } }] },
      select: { id: true, nick: true, steamName: true },
    });
    for (const u of users) {
      if (u.nick) {
        const k = nickCompact(u.nick);
        if (k && !nickToUserId.has(k)) nickToUserId.set(k, u.id);
      }
      if (u.steamName) {
        const k = nickCompact(u.steamName);
        if (k && !nickToUserId.has(k)) nickToUserId.set(k, u.id);
      }
    }
  }

  let credited = 0;
  for (const p of match.players) {
    const userId = p.userId || nickToUserId.get(nickCompact(p.nick)) || null;
    if (!userId) continue;
    if (!p.userId) {
      // backfill for next runs
      await prisma.canonMatchPlayer
        .update({ where: { id: p.id }, data: { userId } })
        .catch(() => null);
    }
    const membership = await prisma.factionMember.findFirst({
      where: { userId },
      select: { factionId: true },
    });
    if (!membership) continue;
    const amount = grindAmountFromTrainStats({
      kills: p.kills,
      res: p.res,
      dmg: p.dmg,
      vehicleKills: p.vehicleKills,
    });
    if (amount <= 0) continue;
    const sourceKey = `grind:${matchId}:${userId}`;
    try {
      await prisma.$transaction(async (tx) => {
        await creditTreasury(
          tx,
          membership.factionId,
          amount,
          "grind",
          sourceKey,
          `TR ${match.serverKey} · ${match.mapName} · ${p.nick}`,
          userId,
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

/** Прогнать гринд по недавним TRAIN на TR1–TR5 (ключ в БД часто lowercase). */
export async function creditGrindRecentTrains(limit = 40): Promise<number> {
  const serverKeys = [
    ...TRAINING_SERVER_KEYS,
    ...TRAINING_SERVER_KEYS.map((k) => k.toLowerCase()),
  ];
  const rows = await prisma.canonMatch.findMany({
    where: {
      kind: "TRAIN",
      serverKey: { in: serverKeys },
      publishedAt: { not: null },
      legacyId: { not: null },
    },
    orderBy: { publishedAt: "desc" },
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

/**
 * Стата для оценочной стоимости / аналитики трансфера.
 * Источник = личный профиль: ProfileMatchLine kind=train (как вкладка тренировок).
 */
export async function loadPlayerPriceStats(
  userIds: string[],
): Promise<Map<string, PlayerPriceStats>> {
  const out = new Map<string, PlayerPriceStats>();
  const uniq = [...new Set(userIds.filter(Boolean))];
  for (const id of uniq) {
    out.set(id, {
      trainDays14: 0,
      matches30: 0,
      kills30: 0,
      deaths30: 0,
      res30: 0,
      nok30: 0,
      lastSeenDaysAgo: null,
    });
  }
  if (!uniq.length) return out;

  const now = Date.now();
  const users = await prisma.user.findMany({
    where: { id: { in: uniq } },
    select: { id: true, nick: true, steamName: true, steamId: true, lastSeenAt: true },
  });

  const userByNickKey = new Map<string, string>();
  for (const u of users) {
    const row = out.get(u.id)!;
    if (u.lastSeenAt) {
      row.lastSeenDaysAgo = Math.floor((now - u.lastSeenAt.getTime()) / 86_400_000);
    }
    const nick = (u.nick || u.steamName || "").trim();
    if (!nick) continue;
    const key = profileHistoryKey(nick, u.steamId);
    if (key) userByNickKey.set(key, u.id);
  }

  const nickKeys = [...userByNickKey.keys()];
  if (!nickKeys.length) return out;

  const since30 = new Date(now - 30 * 86_400_000);
  const ymd30 = since30.toISOString().slice(0, 10);
  const ymd14 = new Date(now - 14 * 86_400_000).toISOString().slice(0, 10);

  const lines = await prisma.profileMatchLine.findMany({
    where: {
      kind: "train",
      nickKey: { in: nickKeys },
      playedOn: { gte: ymd30 },
    },
    select: {
      nickKey: true,
      matchId: true,
      playedOn: true,
      kills: true,
      deaths: true,
      res: true,
      nok: true,
    },
  });

  const days14 = new Map<string, Set<string>>();
  const matches30 = new Map<string, Set<string>>();
  for (const line of lines) {
    const uid = userByNickKey.get(line.nickKey);
    if (!uid) continue;
    const row = out.get(uid);
    if (!row) continue;
    if (!matches30.has(uid)) matches30.set(uid, new Set());
    matches30.get(uid)!.add(line.matchId || `${line.playedOn}:${line.kills}:${line.deaths}`);
    row.kills30 += line.kills;
    row.deaths30 += line.deaths;
    row.res30 += line.res;
    row.nok30 += line.nok;
    if (line.playedOn >= ymd14) {
      if (!days14.has(uid)) days14.set(uid, new Set());
      days14.get(uid)!.add(line.playedOn);
    }
  }
  for (const [uid, set] of days14) {
    const row = out.get(uid);
    if (row) row.trainDays14 = set.size;
  }
  for (const [uid, set] of matches30) {
    const row = out.get(uid);
    if (row) row.matches30 = set.size;
  }
  return out;
}

export function estimateWithKit(
  stats: PlayerPriceStats | undefined,
  kitKey: string | null | undefined,
  scarcityLevel?: ScarcityForPrice,
): number {
  return estimatePlayerPrice({
    ...(stats || {
      trainDays14: 0,
      matches30: 0,
      kills30: 0,
      deaths30: 0,
      res30: 0,
      nok30: 0,
      lastSeenDaysAgo: null,
    }),
    kitKey,
    scarcityLevel: scarcityLevel ?? stats?.scarcityLevel,
  });
}

export async function loadListingBoard(opts?: {
  buyerScarcityByKit?: Record<string, ScarcityForPrice>;
}) {
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
  const [kits, priceStats] = await Promise.all([
    mainKitByUserIds(userIds),
    loadPlayerPriceStats(userIds),
  ]);

  return listings.map((l) => {
    const u = byId[l.playerUserId];
    const kit = kits.get(l.playerUserId) || null;
    const kitNorm = normalizeKit(kit);
    const liveEst = estimateWithKit(
      priceStats.get(l.playerUserId),
      kit,
      opts?.buyerScarcityByKit?.[kitNorm],
    );
    const st = priceStats.get(l.playerUserId);
    return {
      id: l.id,
      askPrice: l.askPrice,
      estimatePrice: liveEst,
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
          }
        : null,
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

  const ask = offer.listing.askPrice;
  await notifyDealClosedMail({
    playerId,
    swapUserId: offer.swapUserId,
    fromFactionName: offer.listing.faction.name,
    toFactionName: offer.fromFaction.name,
    cash,
    type: offer.type,
    askPrice: ask,
    offerId: offer.id,
  }).catch((e) => console.error("transfer mail failed", e));

  return { ok: true as const };
}

function offerTypeRu(type: string): string {
  if (type === "SWAP_CASH") return "обмен + доплата";
  if (type === "SWAP") return "обмен игроками";
  if (type === "BUY") return "покупка";
  return type;
}

async function factionStaffIds(factionId: string): Promise<string[]> {
  const rows = await prisma.factionMember.findMany({
    where: { factionId, seat: { in: ["LEADER", "DEPUTY"] } },
    select: { userId: true },
  });
  return [...new Set(rows.map((r) => r.userId))];
}

/** Все участники фракций BB (для публичных алертов о сделках). */
async function allBbFactionMemberIds(): Promise<string[]> {
  const bb = await prisma.clan.findFirst({
    where: { tag: "BB", isExternal: false },
    select: { id: true },
  });
  if (!bb) return [];
  const rows = await prisma.factionMember.findMany({
    where: { faction: { clanId: bb.id } },
    select: { userId: true },
  });
  return [...new Set(rows.map((r) => r.userId))];
}

async function nickOf(userId: string | null | undefined): Promise<string> {
  if (!userId) return "—";
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { nick: true, name: true, steamName: true },
  });
  if (!u) return "—";
  return (u.nick || u.steamName || u.name || "—").trim() || "—";
}

async function sendSoftTransferMail(opts: {
  toUserId?: string;
  toUserIds?: string[];
  title: string;
  body: string;
  sourceKey?: string | null;
}) {
  const authorId = await keechAuthorId();
  const ids = [
    ...new Set(
      [...(opts.toUserIds || []), ...(opts.toUserId ? [opts.toUserId] : [])].filter(Boolean),
    ),
  ];
  if (!authorId || !ids.length) return null;
  try {
    const mail = await prisma.profileMail.create({
      data: {
        title: opts.title,
        body: opts.body,
        senderKind: "transfer",
        senderLabel: "Трансферный штаб",
        tags: ["Трансфер"],
        sourceKey: opts.sourceKey || null,
        authorId,
        recipients: { create: ids.map((userId) => ({ userId })) },
      },
      select: { id: true },
    });
    return mail.id;
  } catch (e) {
    // unique sourceKey — уже слали
    console.error("transfer soft mail failed", e);
    return null;
  }
}

/** Игрока выставили на доску. */
export async function notifyListedMail(opts: {
  playerUserId: string;
  factionName: string;
  askPrice: number;
  estimatePrice: number;
  listingId: string;
  note?: string | null;
}) {
  const body = [
    `Командование фракции «${opts.factionName}» выставило тебя на трансферную доску.`,
    `Запрос продавца: ${opts.askPrice.toLocaleString("ru-RU")} ${BD_MARK}.`,
    `Оценочная стоимость: ${opts.estimatePrice.toLocaleString("ru-RU")} ${BD_MARK}.`,
    opts.note ? `Комментарий штаба: ${opts.note}` : null,
    `Это ещё не переход — только объявление. Если офер примут, ты получишь отдельное письмо с деталями сделки.`,
    `Вопросы — командиру или заму фракции.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  return sendSoftTransferMail({
    toUserId: opts.playerUserId,
    title: "Тебя выставили на трансфер",
    body,
    sourceKey: `xfer:listed:${opts.listingId}`,
  });
}

/** Сняли с доски. */
export async function notifyWithdrawnMail(opts: {
  playerUserId: string;
  factionName: string;
  listingId: string;
  askPrice: number;
}) {
  const body = [
    `Командование «${opts.factionName}» сняло тебя с трансферной доски.`,
    `Последний запрос был ${opts.askPrice.toLocaleString("ru-RU")} ${BD_MARK}.`,
    `Сейчас ты снова просто в составе фракции — переход не состоялся.`,
  ].join("\n\n");

  return sendSoftTransferMail({
    toUserId: opts.playerUserId,
    title: "Сняли с трансферной доски",
    body,
    sourceKey: `xfer:withdrawn:${opts.listingId}:${Date.now()}`,
  });
}

/** Пришёл офер: игрок на доске, игрок на обмен, штаб продающей фракции. */
export async function notifyOfferMail(opts: {
  listedPlayerId: string;
  listedPlayerNick?: string | null;
  listedFactionId: string;
  listedFactionName: string;
  fromFactionId: string;
  fromFactionName: string;
  type: string;
  cashAmount: number;
  askPrice: number;
  offerId: string;
  swapUserId?: string | null;
  swapNick?: string | null;
  message?: string | null;
}) {
  const typeRu = offerTypeRu(opts.type);
  const money =
    opts.cashAmount > 0
      ? `Сумма / доплата: ${opts.cashAmount.toLocaleString("ru-RU")} ${BD_MARK}.`
      : "Без денежной части.";
  const swapLine = opts.swapNick
    ? `Взамен предлагают игрока: ${opts.swapNick}.`
    : opts.swapUserId
      ? "Взамен предлагают своего игрока."
      : null;
  const listedNick = opts.listedPlayerNick || "игрок";

  const listedBody = [
    `На тебя пришёл офер от фракции «${opts.fromFactionName}».`,
    `Тип: ${typeRu}.`,
    `Твоя фракция «${opts.listedFactionName}» выставила запрос ${opts.askPrice.toLocaleString("ru-RU")} ${BD_MARK}.`,
    money,
    swapLine,
    opts.message ? `Сообщение к оферу: ${opts.message}` : null,
    `Решение принимает командир / зам. Пока офер не принят — ты остаёшься в «${opts.listedFactionName}».`,
  ]
    .filter(Boolean)
    .join("\n\n");

  await sendSoftTransferMail({
    toUserId: opts.listedPlayerId,
    title: "На тебя пришёл трансферный офер",
    body: listedBody,
    sourceKey: `xfer:offer:${opts.offerId}:listed`,
  });

  if (opts.swapUserId) {
    const swapBody = [
      `Командование «${opts.fromFactionName}» предлагает тебя в обмен за игрока из «${opts.listedFactionName}».`,
      `Тип сделки: ${typeRu}.`,
      money,
      `Если офер примут — ты перейдёшь в «${opts.listedFactionName}». Пока это только предложение.`,
      `Детали — у командира.`,
    ].join("\n\n");
    await sendSoftTransferMail({
      toUserId: opts.swapUserId,
      title: "Тебя предложили в обмен",
      body: swapBody,
      sourceKey: `xfer:offer:${opts.offerId}:swap`,
    });
  }

  // Штаб продающей фракции (глава + замы)
  const staff = await factionStaffIds(opts.listedFactionId);
  if (staff.length) {
    const staffBody = [
      `Новое предложение по трансферу от «${opts.fromFactionName}».`,
      `Игрок на доске: ${listedNick} (запрос ${opts.askPrice.toLocaleString("ru-RU")} ${BD_MARK}).`,
      `Тип: ${typeRu}.`,
      money,
      swapLine,
      opts.message ? `Комментарий: ${opts.message}` : null,
      `Открой вкладку Трансферы → «Входящие сделки»: принять или отклонить.`,
    ]
      .filter(Boolean)
      .join("\n\n");
    await sendSoftTransferMail({
      toUserIds: staff,
      title: "Входящая сделка по трансферу",
      body: staffBody,
      sourceKey: `xfer:offer:${opts.offerId}:staff`,
    });
  }

  // Подтверждение штабу покупателя
  const buyerStaff = await factionStaffIds(opts.fromFactionId);
  if (buyerStaff.length) {
    await sendSoftTransferMail({
      toUserIds: buyerStaff,
      title: "Ваш трансферный офер отправлен",
      body: [
        `Офер ушёл в «${opts.listedFactionName}» по игроку ${listedNick}.`,
        `Тип: ${typeRu}.`,
        money,
        swapLine,
        `Ждите решения командира продающей фракции — придёт отдельное письмо.`,
      ]
        .filter(Boolean)
        .join("\n\n"),
      sourceKey: `xfer:offer:${opts.offerId}:buyer_staff`,
    });
  }
}

/** Офер отклонён — письма участникам. */
export async function notifyOfferDeclinedMail(opts: {
  offerId: string;
  listedPlayerId: string;
  listedFactionName: string;
  fromFactionId: string;
  fromFactionName: string;
  type: string;
  cashAmount: number;
  swapUserId?: string | null;
}) {
  const typeRu = offerTypeRu(opts.type);
  const money =
    opts.cashAmount > 0
      ? `Сумма / доплата в офере: ${opts.cashAmount.toLocaleString("ru-RU")} ${BD_MARK}.`
      : null;
  const common = [
    `Офер отклонён штабом «${opts.listedFactionName}».`,
    `Тип был: ${typeRu}.`,
    money,
    `Сделка не состоялась.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  await sendSoftTransferMail({
    toUserId: opts.listedPlayerId,
    title: "Трансферный офер отклонён",
    body: common,
    sourceKey: `xfer:decline:${opts.offerId}:listed`,
  });
  if (opts.swapUserId) {
    await sendSoftTransferMail({
      toUserId: opts.swapUserId,
      title: "Обмен по трансферу отклонён",
      body: common,
      sourceKey: `xfer:decline:${opts.offerId}:swap`,
    });
  }
  const buyerStaff = await factionStaffIds(opts.fromFactionId);
  if (buyerStaff.length) {
    await sendSoftTransferMail({
      toUserIds: buyerStaff,
      title: "Ваш трансферный офер отклонён",
      body: [
        `«${opts.listedFactionName}» отклонили предложение от «${opts.fromFactionName}».`,
        `Тип: ${typeRu}.`,
        money,
      ]
        .filter(Boolean)
        .join("\n\n"),
      sourceKey: `xfer:decline:${opts.offerId}:buyer_staff`,
    });
  }
}

/** Сделка закрыта — письмо игроку(ам) + публичный алерт всем во фракциях BB. */
async function notifyDealClosedMail(opts: {
  playerId: string;
  swapUserId: string | null;
  fromFactionName: string;
  toFactionName: string;
  cash: number;
  type: string;
  askPrice: number;
  offerId: string;
}) {
  const typeRu = offerTypeRu(opts.type);
  const money =
    opts.cash > 0
      ? `По сделке прошло ${opts.cash.toLocaleString("ru-RU")} ${BD_MARK}.`
      : "Денежной части не было.";
  const playerNick = await nickOf(opts.playerId);
  const swapNick = opts.swapUserId ? await nickOf(opts.swapUserId) : null;

  const bodyMain = [
    `Сделка закрыта: ты переходишь из «${opts.fromFactionName}» в «${opts.toFactionName}».`,
    `Тип: ${typeRu}.`,
    `Запрос на доске был ${opts.askPrice.toLocaleString("ru-RU")} ${BD_MARK}.`,
    money,
    `На ${TRANSFER_LOCK_DAYS} суток стоит трансферный лок — снова выставить на доску нельзя.`,
    `Это решение штаба. Если что-то непонятно — спроси нового командира.`,
  ].join("\n\n");

  await sendSoftTransferMail({
    toUserId: opts.playerId,
    title: "Переход во фракцию — сделка закрыта",
    body: bodyMain,
    sourceKey: `xfer:deal:${opts.offerId}:player`,
  });

  if (opts.swapUserId) {
    const swapBody = [
      `Сделка закрыта: ты переходишь из «${opts.toFactionName}» в «${opts.fromFactionName}» (обмен).`,
      `Тип: ${typeRu}.`,
      money,
      `Лок ${TRANSFER_LOCK_DAYS} суток. Решение штаба — детали у командира.`,
    ].join("\n\n");
    await sendSoftTransferMail({
      toUserId: opts.swapUserId,
      title: "Обмен между фракциями — сделка закрыта",
      body: swapBody,
      sourceKey: `xfer:deal:${opts.offerId}:swap`,
    });
  }

  // Публично: все игроки во фракциях BB видят успешные сделки
  const everyone = await allBbFactionMemberIds();
  if (everyone.length) {
    const publicLines = [
      `Успешная сделка на трансферном рынке.`,
      "",
      `${playerNick}: «${opts.fromFactionName}» → «${opts.toFactionName}»`,
      swapNick
        ? `${swapNick}: «${opts.toFactionName}» → «${opts.fromFactionName}» (обмен)`
        : null,
      `Тип: ${typeRu}.`,
      money,
      "",
      "Смотри вкладку «Успешные сделки» у своей фракции.",
    ].filter((x): x is string => Boolean(x));
    await sendSoftTransferMail({
      toUserIds: everyone,
      title: `Сделка · ${playerNick}: «${opts.fromFactionName}» → «${opts.toFactionName}»`,
      body: publicLines.join("\n"),
      sourceKey: `xfer:deal:${opts.offerId}:broadcast`,
    });
  }
}

export { estimatePlayerPrice };
