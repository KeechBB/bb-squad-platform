/**
 * Оплата площадки из казны фракции (B$). Только глава / зам (+ Keech).
 */
import { prisma } from "@/lib/prisma";
import { isBuiltinSuperAdmin } from "@/lib/admin";
import { SITE_CREATOR_STEAM_ID } from "@/lib/profileBg";
import { BD_MARK } from "@/lib/blueberryDollar";

export type FactionPayCtx = {
  factionId: string;
  factionName: string;
  balance: number;
  seat: "LEADER" | "DEPUTY" | "MEMBER" | null;
  canSpend: boolean;
};

export type FactionMarketMember = {
  userId: string;
  nick: string;
  seat: "LEADER" | "DEPUTY" | "MEMBER";
};

export async function getFactionPayCtx(
  userId: string,
  steamId: string
): Promise<FactionPayCtx | null> {
  const mem = await prisma.factionMember.findUnique({
    where: { userId },
    select: {
      seat: true,
      faction: { select: { id: true, name: true, blueberryBalance: true } },
    },
  });
  if (!mem) return null;
  const keech =
    isBuiltinSuperAdmin(steamId) || steamId === SITE_CREATOR_STEAM_ID;
  const canSpend =
    keech || mem.seat === "LEADER" || mem.seat === "DEPUTY";
  return {
    factionId: mem.faction.id,
    factionName: mem.faction.name,
    balance: Math.max(0, mem.faction.blueberryBalance || 0),
    seat: mem.seat,
    canSpend,
  };
}

/** Состав фракции для подарка с площадки (B$). */
export async function listFactionMarketMembers(
  factionId: string
): Promise<FactionMarketMember[]> {
  const rows = await prisma.factionMember.findMany({
    where: { factionId },
    select: {
      userId: true,
      seat: true,
      user: { select: { nick: true, steamId: true } },
    },
    orderBy: [{ seat: "asc" }, { joinedAt: "asc" }],
  });
  const seatRank = { LEADER: 0, DEPUTY: 1, MEMBER: 2 } as const;
  return rows
    .filter((r) => !isBuiltinSuperAdmin(r.user.steamId))
    .map((r) => ({
      userId: r.userId,
      nick: r.user.nick || "—",
      seat: r.seat,
    }))
    .sort(
      (a, b) =>
        seatRank[a.seat] - seatRank[b.seat] ||
        a.nick.localeCompare(b.nick, "ru")
    );
}

/**
 * Кому уйдёт предмет за B$.
 * — без gift / gift=себе → себе, казна не нужна;
 * — gift другому → только глава/зам, списание с казны.
 */
export async function resolveBdGiftRecipient(opts: {
  buyerUserId: string;
  buyerSteamId: string;
  giftToUserId: string | null | undefined;
}): Promise<
  | {
      ok: true;
      recipientUserId: string;
      factionId: string;
      spendTreasury: boolean;
    }
  | { ok: false; error: string }
> {
  const ctx = await getFactionPayCtx(opts.buyerUserId, opts.buyerSteamId);
  if (!ctx) return { ok: false, error: "no_faction" };
  const giftTo = String(opts.giftToUserId || "").trim();
  if (!giftTo || giftTo === opts.buyerUserId) {
    return {
      ok: true,
      recipientUserId: opts.buyerUserId,
      factionId: ctx.factionId,
      spendTreasury: false,
    };
  }
  if (!ctx.canSpend) return { ok: false, error: "forbidden_seat" };
  const target = await prisma.factionMember.findUnique({
    where: { userId: giftTo },
    select: { factionId: true },
  });
  if (!target || target.factionId !== ctx.factionId) {
    return { ok: false, error: "gift_not_member" };
  }
  return {
    ok: true,
    recipientUserId: giftTo,
    factionId: ctx.factionId,
    spendTreasury: true,
  };
}

export async function debitFactionBd(opts: {
  factionId: string;
  amount: number;
  userId: string;
  note: string;
  sourceKey: string;
}): Promise<{ ok: true; balance: number } | { ok: false; error: string }> {
  const amount = Math.trunc(opts.amount);
  if (amount < 1) return { ok: false, error: "zero" };
  try {
    const balance = await prisma.$transaction(async (tx) => {
      const exists = await tx.factionLedgerEntry.findUnique({
        where: { sourceKey: opts.sourceKey },
      });
      if (exists) {
        const f = await tx.faction.findUnique({
          where: { id: opts.factionId },
          select: { blueberryBalance: true },
        });
        return Math.max(0, f?.blueberryBalance || 0);
      }
      const f = await tx.faction.findUnique({
        where: { id: opts.factionId },
        select: { blueberryBalance: true },
      });
      if (!f) throw new Error("faction");
      const cur = Math.max(0, f.blueberryBalance || 0);
      if (cur < amount) throw new Error("insufficient");
      const next = cur - amount;
      await tx.factionLedgerEntry.create({
        data: {
          factionId: opts.factionId,
          amount: -amount,
          kind: "market_buy",
          sourceKey: opts.sourceKey,
          note: opts.note,
          userId: opts.userId,
        },
      });
      await tx.faction.update({
        where: { id: opts.factionId },
        data: { blueberryBalance: next },
      });
      return next;
    });
    return { ok: true, balance };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "insufficient") return { ok: false, error: "insufficient" };
    return { ok: false, error: "debit" };
  }
}

export async function creditFactionBd(opts: {
  factionId: string;
  amount: number;
  userId: string;
  note: string;
  sourceKey: string;
}): Promise<{ ok: true; balance: number } | { ok: false; error: string }> {
  const amount = Math.trunc(opts.amount);
  if (amount < 1) return { ok: false, error: "zero" };
  try {
    const balance = await prisma.$transaction(async (tx) => {
      const exists = await tx.factionLedgerEntry.findUnique({
        where: { sourceKey: opts.sourceKey },
      });
      if (exists) {
        const f = await tx.faction.findUnique({
          where: { id: opts.factionId },
          select: { blueberryBalance: true },
        });
        return Math.max(0, f?.blueberryBalance || 0);
      }
      const f = await tx.faction.update({
        where: { id: opts.factionId },
        data: { blueberryBalance: { increment: amount } },
        select: { blueberryBalance: true },
      });
      await tx.factionLedgerEntry.create({
        data: {
          factionId: opts.factionId,
          amount,
          kind: "market_sell",
          sourceKey: opts.sourceKey,
          note: opts.note,
          userId: opts.userId,
        },
      });
      return Math.max(0, f.blueberryBalance || 0);
    });
    return { ok: true, balance };
  } catch {
    return { ok: false, error: "credit" };
  }
}

export function bdPayErrorMessage(code: string): string {
  if (code === "no_faction")
    return "Нужна фракция: покупка/продажа за $ идёт через казну";
  if (code === "forbidden_seat")
    return `Подарок из казны делает только глава / зам фракции (${BD_MARK})`;
  if (code === "insufficient") return `Недостаточно ${BD_MARK} в казне фракции`;
  if (code === "insufficient_personal")
    return `Недостаточно ${BD_MARK} на личном балансе`;
  if (code === "gift_not_member")
    return "Получатель должен быть в вашей фракции";
  if (code === "gift_self") return "Нельзя перевести себе";
  if (code === "gift_officer") return "Нельзя переводить $ главе или заму";
  if (code === "gift_required") return "Выбери получателя";
  if (code === "amount") return "Укажи сумму больше 0";
  return "Ошибка оплаты $";
}

export async function getPersonalBdBalance(userId: string): Promise<number> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { blueberryBalance: true },
  });
  return Math.max(0, u?.blueberryBalance || 0);
}

export async function creditPersonalBd(opts: {
  userId: string;
  amount: number;
}): Promise<{ ok: true; balance: number } | { ok: false; error: string }> {
  const amount = Math.trunc(opts.amount);
  if (amount < 1) return { ok: false, error: "zero" };
  const u = await prisma.user.update({
    where: { id: opts.userId },
    data: { blueberryBalance: { increment: amount } },
    select: { blueberryBalance: true },
  });
  return { ok: true, balance: Math.max(0, u.blueberryBalance || 0) };
}

export async function debitPersonalBd(opts: {
  userId: string;
  amount: number;
}): Promise<{ ok: true; balance: number } | { ok: false; error: string }> {
  const amount = Math.trunc(opts.amount);
  if (amount < 1) return { ok: false, error: "zero" };
  try {
    const balance = await prisma.$transaction(async (tx) => {
      const u = await tx.user.findUnique({
        where: { id: opts.userId },
        select: { blueberryBalance: true },
      });
      if (!u) throw new Error("user");
      const cur = Math.max(0, u.blueberryBalance || 0);
      if (cur < amount) throw new Error("insufficient");
      const next = cur - amount;
      await tx.user.update({
        where: { id: opts.userId },
        data: { blueberryBalance: next },
      });
      return next;
    });
    return { ok: true, balance };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "insufficient") return { ok: false, error: "insufficient" };
    return { ok: false, error: "debit" };
  }
}

/**
 * Глава/зам дарит B$ участнику: списание с казны → на личный баланс.
 */
export async function giftFactionBdToMember(opts: {
  actorUserId: string;
  actorSteamId: string;
  toUserId: string;
  amount: number;
}): Promise<
  | {
      ok: true;
      factionBalance: number;
      recipientPersonalBalance: number;
      amount: number;
      toUserId: string;
    }
  | { ok: false; error: string }
> {
  const amount = Math.trunc(Number(opts.amount) || 0);
  if (amount < 1) return { ok: false, error: "amount" };
  if (opts.toUserId === opts.actorUserId) return { ok: false, error: "gift_self" };

  const ctx = await getFactionPayCtx(opts.actorUserId, opts.actorSteamId);
  if (!ctx) return { ok: false, error: "no_faction" };
  if (!ctx.canSpend) return { ok: false, error: "forbidden_seat" };

  const target = await prisma.factionMember.findUnique({
    where: { userId: opts.toUserId },
    select: { factionId: true, seat: true },
  });
  if (!target || target.factionId !== ctx.factionId) {
    return { ok: false, error: "gift_not_member" };
  }
  if (target.seat === "LEADER" || target.seat === "DEPUTY") {
    return { ok: false, error: "gift_officer" };
  }

  const sourceKey = `member_gift:${ctx.factionId}:${opts.actorUserId}:${opts.toUserId}:${amount}:${Date.now()}`;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const f = await tx.faction.findUnique({
        where: { id: ctx.factionId },
        select: { blueberryBalance: true },
      });
      if (!f) throw new Error("faction");
      const cur = Math.max(0, f.blueberryBalance || 0);
      if (cur < amount) throw new Error("insufficient");
      const nextTreasury = cur - amount;
      await tx.factionLedgerEntry.create({
        data: {
          factionId: ctx.factionId,
          amount: -amount,
          kind: "member_gift",
          sourceKey,
          note: `Подарок ${amount.toLocaleString("ru-RU")} ${BD_MARK} участнику`,
          userId: opts.actorUserId,
        },
      });
      await tx.faction.update({
        where: { id: ctx.factionId },
        data: { blueberryBalance: nextTreasury },
      });
      const recipient = await tx.user.update({
        where: { id: opts.toUserId },
        data: { blueberryBalance: { increment: amount } },
        select: { blueberryBalance: true },
      });
      return {
        factionBalance: nextTreasury,
        recipientPersonalBalance: Math.max(0, recipient.blueberryBalance || 0),
      };
    });
    return {
      ok: true,
      factionBalance: result.factionBalance,
      recipientPersonalBalance: result.recipientPersonalBalance,
      amount,
      toUserId: opts.toUserId,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "insufficient") return { ok: false, error: "insufficient" };
    return { ok: false, error: "debit" };
  }
}

/**
 * Перевод личного B$ другому игроку той же фракции.
 * Казна не участвует. Главе и заму переводить нельзя.
 */
export async function transferPersonalBd(opts: {
  actorUserId: string;
  toUserId: string;
  amount: number;
}): Promise<
  | {
      ok: true;
      personalBdBalance: number;
      recipientPersonalBalance: number;
      amount: number;
      toUserId: string;
    }
  | { ok: false; error: string }
> {
  const amount = Math.trunc(Number(opts.amount) || 0);
  if (amount < 1) return { ok: false, error: "amount" };
  if (opts.toUserId === opts.actorUserId) return { ok: false, error: "gift_self" };

  const actorMember = await prisma.factionMember.findUnique({
    where: { userId: opts.actorUserId },
    select: { factionId: true },
  });
  if (!actorMember) return { ok: false, error: "no_faction" };

  const target = await prisma.factionMember.findUnique({
    where: { userId: opts.toUserId },
    select: { factionId: true, seat: true },
  });
  if (!target || target.factionId !== actorMember.factionId) {
    return { ok: false, error: "gift_not_member" };
  }
  if (target.seat === "LEADER" || target.seat === "DEPUTY") {
    return { ok: false, error: "gift_officer" };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const sender = await tx.user.findUnique({
        where: { id: opts.actorUserId },
        select: { blueberryBalance: true },
      });
      if (!sender) throw new Error("user");
      const cur = Math.max(0, sender.blueberryBalance || 0);
      if (cur < amount) throw new Error("insufficient_personal");
      const next = cur - amount;
      await tx.user.update({
        where: { id: opts.actorUserId },
        data: { blueberryBalance: next },
      });
      const recipient = await tx.user.update({
        where: { id: opts.toUserId },
        data: { blueberryBalance: { increment: amount } },
        select: { blueberryBalance: true },
      });
      return {
        personalBdBalance: next,
        recipientPersonalBalance: Math.max(0, recipient.blueberryBalance || 0),
      };
    });
    return { ok: true, ...result, amount, toUserId: opts.toUserId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "insufficient_personal") {
      return { ok: false, error: "insufficient_personal" };
    }
    return { ok: false, error: "debit" };
  }
}
