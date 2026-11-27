/**
 * Аукцион рекрутов (СРИ на паузе).
 * После приёма новичка — 16ч ставок фракций; победитель забирает игрока.
 * Выигрыш → банк Аукциона; 10% → личный B$ рекрута; проигравшие — возврат в казну.
 */
import { prisma } from "@/lib/prisma";
import { isBuiltinSuperAdmin } from "@/lib/admin";
import { personLabel, writeActionLog } from "@/lib/actionLog";
import { logFaction } from "@/lib/factions";
import { isActiveReserve } from "@/lib/validation";
import { BD_MARK } from "@/lib/blueberryDollar";
import { formatMskYmd } from "@/lib/squadHits";
import {
  formatDossierBlock,
  hasNormalTgUsername,
  loadRecruitDossierBySteam,
  type RecruitDossier,
} from "@/lib/recruitBotLookup";
import { listSriFactions, isSlagCandidate, SRI_FACTION_NAMES } from "@/lib/sri";

export const AUCTION_SENDER_KIND = "auction";
export const AUCTION_SENDER_LABEL = "Аукцион";
export const AUCTION_HOURS = 16;
export const AUCTION_RECRUIT_CUT_RATIO = 0.1;
/** Самовыставление: доля победной ставки → личный B$ игрока. */
export const AUCTION_SELF_CUT_RATIO = 0.2;

export function auctionEndsAt(from = new Date()): Date {
  return new Date(from.getTime() + AUCTION_HOURS * 60 * 60 * 1000);
}

async function keechUser() {
  const bySteam = await prisma.user.findFirst({
    where: { steamId: "76561198028435874" },
    select: { id: true, nick: true, name: true, steamName: true, steamId: true },
  });
  if (bySteam) return bySteam;
  return prisma.user.findFirst({
    where: { nick: { equals: "Keech", mode: "insensitive" } },
    select: { id: true, nick: true, name: true, steamName: true, steamId: true },
  });
}

async function ensureAuctionBank() {
  return prisma.auctionBank.upsert({
    where: { id: "global" },
    create: { id: "global", blueberryBalance: 0 },
    update: {},
  });
}

function mskDateTimeLabel(d = new Date()): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

async function mailAuction(opts: {
  authorId: string;
  recipientIds: string[];
  title: string;
  body: string;
  sourceKey: string;
}) {
  const ids = [...new Set(opts.recipientIds.filter(Boolean))];
  if (!ids.length) return null;
  try {
    const mail = await prisma.profileMail.create({
      data: {
        title: opts.title,
        body: opts.body,
        senderKind: AUCTION_SENDER_KIND,
        senderLabel: AUCTION_SENDER_LABEL,
        tags: ["Аукцион", "Фракции"],
        sourceKey: opts.sourceKey,
        authorId: opts.authorId,
        recipients: { create: ids.map((userId) => ({ userId })) },
      },
      select: { id: true },
    });
    return mail.id;
  } catch (e) {
    // sourceKey unique — повторный тик
    if (String(e).includes("Unique constraint")) return null;
    console.error("auction mail failed", e);
    return null;
  }
}

async function staffIdsForAuctionFactions(): Promise<string[]> {
  const factions = await listSriFactions();
  const ids: string[] = [];
  for (const f of factions) {
    ids.push(...f.leaderIds, ...f.deputyIds);
  }
  const keech = await keechUser();
  if (keech) ids.push(keech.id);
  return [...new Set(ids)];
}

/**
 * Новичок прошёл бота → лот на 16ч (вместо СРИ).
 */
export async function openRecruitAuction(opts: {
  userId: string;
  reason?: string;
}): Promise<
  | {
      ok: true;
      lotId: string;
      nick: string;
      endsAt: string;
      mailId: string | null;
    }
  | { ok: false; skipped: string; nick?: string }
> {
  const keech = await keechUser();
  if (!keech) return { ok: false, skipped: "no_keech" };

  const user = await prisma.user.findUnique({
    where: { id: opts.userId },
    select: {
      id: true,
      nick: true,
      name: true,
      steamName: true,
      steamId: true,
      reserveUntil: true,
      factionMembership: { select: { id: true } },
      clanMemberships: {
        where: { clan: { tag: "BB", isExternal: false } },
        select: { role: true },
      },
    },
  });
  if (!user) return { ok: false, skipped: "user_not_found" };
  if (!user.steamId || isBuiltinSuperAdmin(user.steamId)) {
    return { ok: false, skipped: "keech_or_admin" };
  }
  if (!user.clanMemberships.length) return { ok: false, skipped: "not_in_bb" };
  if (user.clanMemberships[0].role === "RESERVE" || isActiveReserve(user.reserveUntil)) {
    return { ok: false, skipped: "in_reserve" };
  }
  if (user.factionMembership) return { ok: false, skipped: "already_in_faction" };

  const openLot = await prisma.factionAuctionLot.findFirst({
    where: { userId: user.id, status: "OPEN" },
  });
  if (openLot) {
    return {
      ok: true,
      lotId: openLot.id,
      nick: personLabel(user),
      endsAt: openLot.endsAt.toISOString(),
      mailId: null,
    };
  }

  const dossier = user.steamId ? loadRecruitDossierBySteam(user.steamId) : null;
  if (
    isSlagCandidate({
      nick: user.nick,
      steamName: user.steamName,
      dossier,
      recruitFlow: true,
    })
  ) {
    return { ok: false, skipped: "slag", nick: personLabel(user) };
  }

  const startsAt = new Date();
  const endsAt = auctionEndsAt(startsAt);
  const nick = personLabel(user);
  const lot = await prisma.factionAuctionLot.create({
    data: {
      userId: user.id,
      status: "OPEN",
      startsAt,
      endsAt,
      note: opts.reason || "recruit",
    },
  });

  await writeActionLog({
    category: "admin",
    action: "auction_open",
    message: `Аукцион: ${nick} на торгах до ${mskDateTimeLabel(endsAt)} МСК`,
    actorId: keech.id,
    actorNick: "Аукцион",
    targetId: user.id,
    targetNick: nick,
    meta: { lotId: lot.id, endsAt: endsAt.toISOString() },
  });

  const recipients = await staffIdsForAuctionFactions();
  const tgLabel = hasNormalTgUsername(dossier?.tgUsername)
    ? `@${String(dossier?.tgUsername).replace(/^@+/, "")}`
    : "—";
  const mailId = await mailAuction({
    authorId: keech.id,
    recipientIds: recipients,
    title: `Аукцион · ${nick}`,
    body: [
      `Новичок ${nick} (${tgLabel}) выставлен на аукцион.`,
      "",
      `Торги: ${AUCTION_HOURS} ч · до ${mskDateTimeLabel(endsAt)} (МСК)`,
      `Побеждает фракция с наибольшей ставкой. Проигравшие получают B$ обратно в казну.`,
      `10% от победной ставки — рекруту на личный баланс; остальное в банк Аукциона.`,
      "",
      formatDossierBlock(dossier, nick),
      "",
      "Ставки — в Менеджмент → Аукцион.",
      "",
      "— Аукцион",
    ].join("\n"),
    sourceKey: `auction:open:${lot.id}`,
  });

  return {
    ok: true,
    lotId: lot.id,
    nick,
    endsAt: endsAt.toISOString(),
    mailId,
  };
}

export async function placeAuctionBid(opts: {
  lotId: string;
  factionId: string;
  amountBd: number;
  placedByUserId: string;
}): Promise<{ ok: true; amountBd: number } | { ok: false; error: string }> {
  const amount = Math.max(0, Math.round(opts.amountBd));
  if (amount < 1) return { ok: false, error: "bad_amount" };

  await settleDueAuctions();

  const lot = await prisma.factionAuctionLot.findUnique({
    where: { id: opts.lotId },
    include: {
      bids: true,
      user: { select: { nick: true, steamName: true, name: true } },
    },
  });
  if (!lot || lot.status !== "OPEN") return { ok: false, error: "lot_closed" };
  if (lot.endsAt.getTime() <= Date.now()) {
    await settleAuctionLot(lot.id);
    return { ok: false, error: "lot_ended" };
  }

  const faction = await prisma.faction.findUnique({
    where: { id: opts.factionId },
    select: { id: true, name: true, blueberryBalance: true },
  });
  if (!faction) return { ok: false, error: "faction_missing" };
  if (!SRI_FACTION_NAMES.includes(faction.name as (typeof SRI_FACTION_NAMES)[number])) {
    return { ok: false, error: "faction_not_allowed" };
  }

  const minBid = Math.max(0, Math.round(Number(lot.minBidBd) || 0));
  if (minBid > 0 && amount < minBid) return { ok: false, error: "below_min" };

  const existing = lot.bids.find((b) => b.factionId === opts.factionId);
  const prev = existing && existing.status === "ACTIVE" ? existing.amountBd : 0;
  if (amount <= prev) return { ok: false, error: "not_higher" };

  const maxOther = lot.bids
    .filter((b) => b.factionId !== opts.factionId && b.status === "ACTIVE")
    .reduce((m, b) => Math.max(m, b.amountBd), 0);
  if (amount <= maxOther) return { ok: false, error: "below_leader" };

  const delta = amount - prev;
  if (faction.blueberryBalance < delta) return { ok: false, error: "treasury_low" };

  const lotNick = personLabel(lot.user);
  await ensureAuctionBank();

  try {
    await prisma.$transaction(async (tx) => {
      const fresh = await tx.faction.findUnique({
        where: { id: opts.factionId },
        select: { blueberryBalance: true },
      });
      if (!fresh || fresh.blueberryBalance < delta) throw new Error("treasury_low");

      await tx.faction.update({
        where: { id: opts.factionId },
        data: { blueberryBalance: { decrement: delta } },
      });
      await tx.auctionBank.update({
        where: { id: "global" },
        data: { blueberryBalance: { increment: delta } },
      });
      await tx.factionLedgerEntry.create({
        data: {
          factionId: opts.factionId,
          amount: -delta,
          kind: "auction_bid",
          sourceKey: `auction_bid:${opts.lotId}:${opts.factionId}:${amount}`,
          note: `Ставка на аукционе (−${delta.toLocaleString("ru-RU")} ${BD_MARK}) · ${lotNick}`,
          userId: opts.placedByUserId,
        },
      });

      if (existing) {
        await tx.factionAuctionBid.update({
          where: { id: existing.id },
          data: {
            amountBd: amount,
            status: "ACTIVE",
            placedByUserId: opts.placedByUserId,
          },
        });
      } else {
        await tx.factionAuctionBid.create({
          data: {
            lotId: opts.lotId,
            factionId: opts.factionId,
            amountBd: amount,
            status: "ACTIVE",
            placedByUserId: opts.placedByUserId,
          },
        });
      }
    });
  } catch (e) {
    if (e instanceof Error && e.message === "treasury_low") {
      return { ok: false, error: "treasury_low" };
    }
    console.error("placeAuctionBid", e);
    return { ok: false, error: "failed" };
  }

  return { ok: true, amountBd: amount };
}

export async function settleAuctionLot(lotId: string): Promise<{
  ok: boolean;
  reason?: string;
}> {
  const keech = await keechUser();
  if (!keech) return { ok: false, reason: "no_keech" };

  const lot = await prisma.factionAuctionLot.findUnique({
    where: { id: lotId },
    include: {
      bids: { include: { faction: { select: { id: true, name: true, clanId: true } } } },
      user: {
        select: {
          id: true,
          nick: true,
          name: true,
          steamName: true,
          steamId: true,
          factionMembership: { select: { id: true } },
        },
      },
    },
  });
  if (!lot) return { ok: false, reason: "not_found" };
  if (lot.status !== "OPEN") return { ok: false, reason: "already_done" };

  const active = lot.bids.filter((b) => b.status === "ACTIVE");
  active.sort((a, b) => b.amountBd - a.amountBd || a.createdAt.getTime() - b.createdAt.getTime());
  const winner = active[0] || null;
  const nick = personLabel(lot.user);
  const dossier = lot.user.steamId
    ? loadRecruitDossierBySteam(lot.user.steamId)
    : null;

  const lotKind = lot.lotKind || "recruit";
  const isSelfList = lotKind === "self_list";

  if (!winner) {
    await prisma.factionAuctionLot.update({
      where: { id: lot.id },
      data: { status: "EXPIRED" },
    });
    const recipients = await staffIdsForAuctionFactions();
    await mailAuction({
      authorId: keech.id,
      recipientIds: isSelfList ? [...recipients, lot.userId] : recipients,
      title: `Аукцион · ${nick} · без ставок`,
      body: [
        isSelfList
          ? `Лот самовыставления ${nick} закрыт без ставок. Игрок остаётся в своей фракции.`
          : `Лот на ${nick} закрыт без ставок. Игрок остаётся свободным агентом.`,
        "",
        "— Аукцион",
      ].join("\n"),
      sourceKey: `auction:expire:${lot.id}`,
    });
    return { ok: true, reason: "no_bids" };
  }

  if (lot.user.factionMembership && !isSelfList) {
    // Рекрут/штраф: уже во фракции — вернуть все ставки
    await refundAllBids(lot.id, active.map((b) => b.id));
    await prisma.factionAuctionLot.update({
      where: { id: lot.id },
      data: { status: "CANCELLED" },
    });
    return { ok: true, reason: "already_in_faction" };
  }

  const winAmt = winner.amountBd;
  const cutRatio = isSelfList ? AUCTION_SELF_CUT_RATIO : AUCTION_RECRUIT_CUT_RATIO;
  const recruitCut = Math.max(0, Math.floor(winAmt * cutRatio));
  const losers = active.filter((b) => b.id !== winner.id);
  const sourceFactionId = lot.sourceFactionId || null;
  const sameFaction =
    isSelfList && sourceFactionId && sourceFactionId === winner.factionId;

  await ensureAuctionBank();

  await prisma.$transaction(async (tx) => {
    const fresh = await tx.factionAuctionLot.findUnique({ where: { id: lot.id } });
    if (!fresh || fresh.status !== "OPEN") return;

    // Рефанд проигравших из банка
    for (const b of losers) {
      await tx.faction.update({
        where: { id: b.factionId },
        data: { blueberryBalance: { increment: b.amountBd } },
      });
      await tx.auctionBank.update({
        where: { id: "global" },
        data: { blueberryBalance: { decrement: b.amountBd } },
      });
      await tx.factionLedgerEntry.create({
        data: {
          factionId: b.factionId,
          amount: b.amountBd,
          kind: "auction_refund",
          sourceKey: `auction_refund:${lot.id}:${b.factionId}`,
          note: `Возврат ставки с аукциона (+${b.amountBd.toLocaleString("ru-RU")} ${BD_MARK}) · ${nick}`,
          userId: lot.userId,
        },
      });
      await tx.factionAuctionBid.update({
        where: { id: b.id },
        data: { status: "REFUNDED" },
      });
    }

    await tx.factionAuctionBid.update({
      where: { id: winner.id },
      data: { status: "WON" },
    });

    if (recruitCut > 0) {
      await tx.auctionBank.update({
        where: { id: "global" },
        data: { blueberryBalance: { decrement: recruitCut } },
      });
      await tx.user.update({
        where: { id: lot.userId },
        data: { blueberryBalance: { increment: recruitCut } },
      });
    }

    if (isSelfList) {
      if (!sameFaction) {
        await tx.factionMember.deleteMany({ where: { userId: lot.userId } });
        await tx.factionMember.create({
          data: {
            factionId: winner.factionId,
            userId: lot.userId,
            seat: "MEMBER",
          },
        });
      }
    } else {
      await tx.factionMember.create({
        data: {
          factionId: winner.factionId,
          userId: lot.userId,
          seat: "MEMBER",
        },
      });
    }
    await tx.factionInvite.updateMany({
      where: { userId: lot.userId, status: { in: ["PENDING", "ACCEPTED"] } },
      data: { status: "CANCELLED" },
    });

    await tx.factionAuctionLot.update({
      where: { id: lot.id },
      data: {
        status: "SETTLED",
        winnerFactionId: winner.factionId,
        winningBidBd: winAmt,
        recruitCutBd: recruitCut,
      },
    });
  });

  if (!sameFaction) {
    await logFaction("join", {
      actorId: keech.id,
      actorNick: "Аукцион",
      targetId: lot.userId,
      targetNick: nick,
      factionName: winner.faction.name,
      clanId: winner.faction.clanId,
      how: isSelfList ? "Аукцион (сам)" : "Аукцион",
      reason: `победная ставка ${winAmt.toLocaleString("ru-RU")} ${BD_MARK}`,
    });
  }

  const staffWinner = await listSriFactions().then(
    (fs) => fs.find((f) => f.id === winner.factionId),
  );
  const winnerRecipients = [
    ...(staffWinner?.leaderIds || []),
    ...(staffWinner?.deputyIds || []),
    keech.id,
    lot.userId,
  ];
  const cutPct = Math.round(cutRatio * 100);
  await mailAuction({
    authorId: keech.id,
    recipientIds: winnerRecipients,
    title: sameFaction
      ? `Аукцион · ${nick} · остаётся в «${winner.faction.name}»`
      : `Аукцион · ${nick} → ${winner.faction.name}`,
    body: [
      sameFaction
        ? `Победа своей фракции: «${winner.faction.name}» выкупила ${nick} за ${winAmt.toLocaleString("ru-RU")} ${BD_MARK} — игрок остаётся в составе.`
        : `Победа: «${winner.faction.name}» забрала ${nick} за ${winAmt.toLocaleString("ru-RU")} ${BD_MARK}.`,
      recruitCut > 0
        ? `Игроку на личный баланс: ${recruitCut.toLocaleString("ru-RU")} ${BD_MARK} (${cutPct}%).`
        : null,
      `Остальное — в банк Аукциона.`,
      "",
      formatDossierBlock(dossier, nick),
      "",
      "— Аукцион",
    ]
      .filter(Boolean)
      .join("\n"),
    sourceKey: `auction:win:${lot.id}`,
  });

  for (const b of losers) {
    const f = await listSriFactions().then((fs) => fs.find((x) => x.id === b.factionId));
    await mailAuction({
      authorId: keech.id,
      recipientIds: [...(f?.leaderIds || []), ...(f?.deputyIds || []), keech.id],
      title: `Аукцион · ${nick} · ставка возвращена`,
      body: [
        `Лот ${nick} выиграла «${winner.faction.name}».`,
        `Ваша ставка ${b.amountBd.toLocaleString("ru-RU")} ${BD_MARK} возвращена в казну.`,
        "",
        "— Аукцион",
      ].join("\n"),
      sourceKey: `auction:refund:${lot.id}:${b.factionId}`,
    });
  }

  await writeActionLog({
    category: "admin",
    action: "auction_settle",
    message: `Аукцион: ${nick} → «${winner.faction.name}» за ${winAmt} ${BD_MARK}`,
    actorId: keech.id,
    actorNick: "Аукцион",
    targetId: lot.userId,
    targetNick: nick,
    clanId: winner.faction.clanId,
    clanTag: "BB",
    meta: {
      lotId: lot.id,
      winAmt,
      recruitCut,
      ymd: formatMskYmd(new Date()),
    },
  });

  return { ok: true };
}

async function refundAllBids(lotId: string, bidIds: string[]) {
  await ensureAuctionBank();
  const lotUser = await prisma.factionAuctionLot.findUnique({
    where: { id: lotId },
    select: { user: { select: { nick: true, steamName: true, name: true } } },
  });
  const lotNick = lotUser ? personLabel(lotUser.user) : "лот";
  for (const id of bidIds) {
    const b = await prisma.factionAuctionBid.findUnique({ where: { id } });
    if (!b || b.status !== "ACTIVE") continue;
    await prisma.$transaction(async (tx) => {
      await tx.faction.update({
        where: { id: b.factionId },
        data: { blueberryBalance: { increment: b.amountBd } },
      });
      await tx.auctionBank.update({
        where: { id: "global" },
        data: { blueberryBalance: { decrement: b.amountBd } },
      });
      await tx.factionLedgerEntry.create({
        data: {
          factionId: b.factionId,
          amount: b.amountBd,
          kind: "auction_refund",
          sourceKey: `auction_refund:${lotId}:${b.factionId}`,
          note: `Возврат ставки с аукциона (+${b.amountBd.toLocaleString("ru-RU")} ${BD_MARK}) · ${lotNick}`,
        },
      });
      await tx.factionAuctionBid.update({
        where: { id: b.id },
        data: { status: "REFUNDED" },
      });
    });
  }
}

export async function settleDueAuctions(): Promise<number> {
  const due = await prisma.factionAuctionLot.findMany({
    where: { status: "OPEN", endsAt: { lte: new Date() } },
    select: { id: true },
    take: 40,
  });
  let n = 0;
  for (const row of due) {
    const r = await settleAuctionLot(row.id);
    if (r.ok) n += 1;
  }
  return n;
}

export async function listAuctionBoard(opts?: { factionId?: string }) {
  await settleDueAuctions();
  await ensureAuctionBank();
  const bank = await prisma.auctionBank.findUnique({ where: { id: "global" } });
  const lots = await prisma.factionAuctionLot.findMany({
    where: { status: { in: ["OPEN", "SETTLED"] } },
    orderBy: [{ status: "asc" }, { endsAt: "desc" }],
    take: 60,
    include: {
      user: {
        select: { id: true, nick: true, steamName: true, steamId: true },
      },
      bids: {
        where: { status: { in: ["ACTIVE", "WON", "REFUNDED"] } },
        include: {
          faction: { select: { id: true, name: true, slug: true } },
        },
        orderBy: { amountBd: "desc" },
      },
    },
  });

  return {
    bankBalance: bank?.blueberryBalance ?? 0,
    hours: AUCTION_HOURS,
    recruitCutRatio: AUCTION_RECRUIT_CUT_RATIO,
    selfCutRatio: AUCTION_SELF_CUT_RATIO,
    /** Фиксированный пресет 5 фракций для сетки ставок. */
    presetFactions: [...SRI_FACTION_NAMES],
    lots: lots.map((l) => {
      const active = l.bids.filter((b) => b.status === "ACTIVE" || b.status === "WON");
      const top = active[0] || null;
      const myBid = opts?.factionId
        ? l.bids.find((b) => b.factionId === opts.factionId) || null
        : null;
      return {
        id: l.id,
        status: l.status,
        startsAt: l.startsAt.toISOString(),
        endsAt: l.endsAt.toISOString(),
        remainingMs: Math.max(0, l.endsAt.getTime() - Date.now()),
        nick: l.user.nick || l.user.steamName || "—",
        steamId: l.user.steamId || "",
        userId: l.userId,
        winningBidBd: l.winningBidBd,
        recruitCutBd: l.recruitCutBd,
        winnerFactionId: l.winnerFactionId,
        lotKind: l.lotKind || "recruit",
        minBidBd: l.minBidBd ?? null,
        sourceFactionId: l.sourceFactionId ?? null,
        raceWindowId: l.raceWindowId ?? null,
        topBid: top
          ? {
              amountBd: top.amountBd,
              factionName: top.faction.name,
              factionId: top.factionId,
              status: top.status,
            }
          : null,
        myBid: myBid
          ? { amountBd: myBid.amountBd, status: myBid.status }
          : null,
        bids: active.map((b) => ({
          factionId: b.factionId,
          factionName: b.faction.name,
          amountBd: b.amountBd,
          status: b.status,
        })),
      };
    }),
  };
}

/** Статус кнопки «На аукцион» для текущего игрока (балансы / HR). */
export async function getSelfListStatus(userId: string | null): Promise<{
  meUserId: string;
  factionId: string;
  factionSlug: string;
  factionName: string;
  personalBd: number;
  marketBd: number;
  enoughBalance: boolean;
  onAuction: boolean;
  lotId: string | null;
  lotKind: string | null;
  contract: { factionName: string; endsAt: string } | null;
} | null> {
  if (!userId) return null;
  const { estimatePlayerPrice } = await import("@/lib/blueberryDollar");
  const { activeContractForUser } = await import("@/lib/factionHr");
  const member = await prisma.factionMember.findUnique({
    where: { userId },
    select: {
      factionId: true,
      faction: { select: { id: true, name: true, slug: true } },
      user: { select: { blueberryBalance: true } },
    },
  });
  if (!member) return null;

  const [openLot, contract, grindRows] = await Promise.all([
    prisma.factionAuctionLot.findFirst({
      where: { userId, status: "OPEN" },
      select: { id: true, lotKind: true },
    }),
    activeContractForUser(userId),
    prisma.factionLedgerEntry.groupBy({
      by: ["userId"],
      where: { userId, kind: "grind", amount: { gt: 0 } },
      _sum: { amount: true },
    }),
  ]);

  const grindBroughtBd = Math.max(0, Math.round(grindRows[0]?._sum.amount || 0));
  const marketBd = estimatePlayerPrice({ grindBroughtBd });
  const personalBd = Math.max(0, member.user.blueberryBalance || 0);
  let contractPayload: { factionName: string; endsAt: string } | null = null;
  if (contract) {
    const fac =
      contract.factionId === member.factionId
        ? member.faction
        : await prisma.faction.findUnique({
            where: { id: contract.factionId },
            select: { name: true },
          });
    contractPayload = {
      factionName: fac?.name || "фракция",
      endsAt: contract.endsAt.toISOString(),
    };
  }

  return {
    meUserId: userId,
    factionId: member.factionId,
    factionSlug: member.faction.slug,
    factionName: member.faction.name,
    personalBd,
    marketBd,
    enoughBalance: personalBd >= marketBd && marketBd > 0,
    onAuction: Boolean(openLot),
    lotId: openLot?.id || null,
    lotKind: openLot?.lotKind || null,
    contract: contractPayload,
  };
}

/**
 * Игрок сам выставляется на аукцион, оставаясь во фракции до покупки.
 * Нужен личный B$ ≥ рыночной стоимости; активный контракт блокирует.
 */
export async function openSelfListAuction(opts: {
  userId: string;
  factionId: string;
}): Promise<
  | {
      ok: true;
      lotId: string;
      nick: string;
      minBidBd: number;
      endsAt: string;
    }
  | { ok: false; error: string; until?: string; factionName?: string }
> {
  const { estimatePlayerPrice, ESTIMATE_BASE } = await import(
    "@/lib/blueberryDollar"
  );
  const { activeContractForUser } = await import("@/lib/factionHr");
  const keech = await keechUser();
  if (!keech) return { ok: false, error: "no_keech" };

  const member = await prisma.factionMember.findFirst({
    where: { factionId: opts.factionId, userId: opts.userId },
    include: {
      user: {
        select: {
          id: true,
          nick: true,
          name: true,
          steamName: true,
          steamId: true,
          blueberryBalance: true,
        },
      },
      faction: { select: { id: true, name: true, clanId: true } },
    },
  });
  if (!member) return { ok: false, error: "not_member" };

  const contract = await activeContractForUser(opts.userId);
  if (contract) {
    const fac = await prisma.faction.findUnique({
      where: { id: contract.factionId },
      select: { name: true },
    });
    return {
      ok: false,
      error: "contract_active",
      until: contract.endsAt.toLocaleDateString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }),
      factionName: fac?.name || "фракция",
    };
  }

  const openLot = await prisma.factionAuctionLot.findFirst({
    where: { userId: opts.userId, status: "OPEN" },
  });
  if (openLot) return { ok: false, error: "already_on_auction" };

  const grindRows = await prisma.factionLedgerEntry.groupBy({
    by: ["userId"],
    where: { userId: opts.userId, kind: "grind", amount: { gt: 0 } },
    _sum: { amount: true },
  });
  const grindBroughtBd = Math.max(0, Math.round(grindRows[0]?._sum.amount || 0));
  const minBidBd = estimatePlayerPrice({ grindBroughtBd });
  const personal = Math.max(0, member.user.blueberryBalance || 0);
  if (personal < minBidBd) return { ok: false, error: "balance_low" };

  const nick = personLabel(member.user);
  const startsAt = new Date();
  const endsAt = auctionEndsAt(startsAt);

  const lot = await prisma.factionAuctionLot.create({
    data: {
      userId: opts.userId,
      status: "OPEN",
      startsAt,
      endsAt,
      lotKind: "self_list",
      minBidBd,
      sourceFactionId: opts.factionId,
      note: `self_list:${opts.factionId}`,
    },
  });

  const recipients = await staffIdsForAuctionFactions();
  await mailAuction({
    authorId: keech.id,
    recipientIds: [...recipients, opts.userId],
    title: `Аукцион · сам · ${nick}`,
    body: [
      `${nick} выставил себя на аукцион (пока остаётся в «${member.faction.name}»).`,
      "",
      `Рыночная стоимость / мин. ставка: ${minBidBd.toLocaleString("ru-RU")} ${BD_MARK}`,
      `(база ${ESTIMATE_BASE.toLocaleString("ru-RU")} + гринд ${grindBroughtBd.toLocaleString("ru-RU")}).`,
      `Торги: ${AUCTION_HOURS} ч · до ${mskDateTimeLabel(endsAt)} (МСК).`,
      `При покупке другой фракцией игроку — ${Math.round(AUCTION_SELF_CUT_RATIO * 100)}% победной ставки на личный B$.`,
      "Свою фракцию тоже можно выкупить.",
      "",
      "Ставки — в Менеджмент → Аукцион.",
      "",
      "— Аукцион",
    ].join("\n"),
    sourceKey: `auction:self:${lot.id}`,
  });

  await writeActionLog({
    category: "faction",
    action: "faction_auction_self_list",
    message: `${nick} сам на аукцион из «${member.faction.name}» (мин. ${minBidBd} ${BD_MARK}).`,
    actorId: opts.userId,
    targetId: opts.userId,
    targetNick: nick,
    clanId: member.faction.clanId,
    clanTag: "BB",
    meta: { lotId: lot.id, minBidBd },
  });

  return {
    ok: true,
    lotId: lot.id,
    nick,
    minBidBd,
    endsAt: endsAt.toISOString(),
  };
}

/**
 * Штраф гонки: игрок уходит из фракции на аукцион.
 * Стартовая / мин. ставка = рыночная стоимость (20 000 + весь гринд).
 */
export async function openRacePenaltyAuction(opts: {
  factionId: string;
  userId: string;
  raceWindowId: string;
  actorUserId: string;
  /** true = автоштраф по истечении grace */
  auto?: boolean;
}): Promise<
  | { ok: true; lotId: string; nick: string; minBidBd: number; endsAt: string }
  | { ok: false; error: string }
> {
  const { estimatePlayerPrice, ESTIMATE_BASE } = await import(
    "@/lib/blueberryDollar"
  );
  const keech = await keechUser();
  if (!keech) return { ok: false, error: "no_keech" };

  const member = await prisma.factionMember.findFirst({
    where: { factionId: opts.factionId, userId: opts.userId },
    include: {
      user: {
        select: {
          id: true,
          nick: true,
          name: true,
          steamName: true,
          steamId: true,
        },
      },
      faction: { select: { id: true, name: true, clanId: true } },
    },
  });
  if (!member) return { ok: false, error: "not_member" };
  if (member.seat !== "MEMBER") return { ok: false, error: "not_member_seat" };

  const openLot = await prisma.factionAuctionLot.findFirst({
    where: { userId: opts.userId, status: "OPEN" },
  });
  if (openLot) return { ok: false, error: "already_on_auction" };

  const grindRows = await prisma.factionLedgerEntry.groupBy({
    by: ["userId"],
    where: { userId: opts.userId, kind: "grind", amount: { gt: 0 } },
    _sum: { amount: true },
  });
  const grindBroughtBd = Math.max(0, Math.round(grindRows[0]?._sum.amount || 0));
  const minBidBd = estimatePlayerPrice({ grindBroughtBd });
  const nick = personLabel(member.user);
  const startsAt = new Date();
  const endsAt = auctionEndsAt(startsAt);

  await prisma.$transaction(async (tx) => {
    await tx.factionMember.deleteMany({
      where: { factionId: opts.factionId, userId: opts.userId },
    });
    await tx.factionInvite.updateMany({
      where: { userId: opts.userId, status: { in: ["PENDING", "ACCEPTED"] } },
      data: { status: "CANCELLED" },
    });
    await tx.transferListing.updateMany({
      where: { playerUserId: opts.userId, status: "ACTIVE" },
      data: { status: "WITHDRAWN" },
    });
    await tx.factionAuctionLot.create({
      data: {
        userId: opts.userId,
        status: "OPEN",
        startsAt,
        endsAt,
        lotKind: "race_penalty",
        minBidBd,
        sourceFactionId: opts.factionId,
        raceWindowId: opts.raceWindowId,
        note: opts.auto
          ? `race_penalty_auto:${opts.raceWindowId}`
          : `race_penalty:${opts.raceWindowId}`,
      },
    });
  });

  const lot = await prisma.factionAuctionLot.findFirst({
    where: { userId: opts.userId, status: "OPEN", lotKind: "race_penalty" },
    orderBy: { createdAt: "desc" },
  });
  if (!lot) return { ok: false, error: "lot_failed" };

  await logFaction("kick", {
    actorId: opts.actorUserId || keech.id,
    actorNick: opts.auto ? "Гонка фракций" : "Штаб · гонка",
    targetId: opts.userId,
    targetNick: nick,
    factionName: member.faction.name,
    clanId: member.faction.clanId,
    how: "аукцион (штраф гонки)",
    reason: opts.auto
      ? "план не выполнен, штаб не выставил игрока вовремя"
      : "фракция не набрала квоту — игрок выставлен на аукцион",
  });

  try {
    const { tryExemptRaceGrace } = await import("@/lib/factionRaceEngine");
    await tryExemptRaceGrace({
      factionId: opts.factionId,
      playerUserId: opts.userId,
      playerNick: nick,
    });
  } catch (e) {
    console.error("race penalty exempt", e);
  }

  const recipients = await staffIdsForAuctionFactions();
  await mailAuction({
    authorId: keech.id,
    recipientIds: [...recipients, opts.userId],
    title: `Аукцион · штраф гонки · ${nick}`,
    body: [
      `Игрок ${nick} выставлен на аукцион из «${member.faction.name}» (штраф гонки).`,
      "",
      `Рыночная стоимость / мин. ставка: ${minBidBd.toLocaleString("ru-RU")} ${BD_MARK}`,
      `(база ${ESTIMATE_BASE.toLocaleString("ru-RU")} + гринд ${grindBroughtBd.toLocaleString("ru-RU")}).`,
      `Торги: ${AUCTION_HOURS} ч · до ${mskDateTimeLabel(endsAt)} (МСК).`,
      opts.auto ? "Выставление автоматическое — штаб не выбрал игрока вовремя." : null,
      "",
      "Ставки — в Менеджмент → Аукцион.",
      "",
      "— Аукцион",
    ]
      .filter(Boolean)
      .join("\n"),
    sourceKey: `auction:race:${lot.id}`,
  });

  await writeActionLog({
    category: "faction",
    action: opts.auto ? "faction_race_auction_auto" : "faction_race_auction",
    message: `Гонка: ${nick} с «${member.faction.name}» → аукцион (мин. ${minBidBd} ${BD_MARK}).`,
    actorId: opts.actorUserId || keech.id,
    targetId: opts.userId,
    targetNick: nick,
    clanId: member.faction.clanId,
    clanTag: "BB",
    meta: {
      lotId: lot.id,
      minBidBd,
      raceWindowId: opts.raceWindowId,
      auto: Boolean(opts.auto),
    },
  });

  return {
    ok: true,
    lotId: lot.id,
    nick,
    minBidBd,
    endsAt: endsAt.toISOString(),
  };
}
