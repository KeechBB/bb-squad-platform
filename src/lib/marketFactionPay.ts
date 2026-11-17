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
  if (code === "no_faction") return "Нужна фракция, чтобы платить B$";
  if (code === "forbidden_seat")
    return `B$ тратит только глава / зам фракции (${BD_MARK})`;
  if (code === "insufficient") return `Недостаточно ${BD_MARK} в казне фракции`;
  return "Ошибка оплаты B$";
}
