/**
 * BB Coins — внутренняя валюта площадки.
 * Источники: верные прогнозы турнира (бывш. BB Points), покупка за ₽, админ.
 * Вывода в рубли нет.
 */
import { prisma } from "@/lib/prisma";
import { BET_POINTS } from "@/lib/tournamentBetSlip";

export const BB_COIN_NAME = "BB Coins";
export const BB_COIN_NAME_SHORT = "BBC";

/** Пакеты покупки за рубли (эквайринг — следующим шагом). */
export const BB_COIN_PACKAGES = [
  { id: "bbc-100", rubles: 99, coins: 100, label: "100 BB Coins" },
  { id: "bbc-500", rubles: 449, coins: 500, label: "500 BB Coins" },
  { id: "bbc-1200", rubles: 999, coins: 1200, label: "1 200 BB Coins", badge: "выгодно" },
  { id: "bbc-3000", rubles: 2299, coins: 3000, label: "3 000 BB Coins" },
] as const;

export type BbCoinPackageId = (typeof BB_COIN_PACKAGES)[number]["id"];

export function bbCoinPackage(id: string) {
  return BB_COIN_PACKAGES.find((p) => p.id === id) || null;
}

export async function getBbCoinBalance(userId: string): Promise<number> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { bbCoins: true },
  });
  return Math.max(0, Number(u?.bbCoins) || 0);
}

async function applyDelta(opts: {
  userId: string;
  delta: number;
  kind: string;
  ref?: string | null;
  note?: string | null;
}): Promise<{ ok: true; balance: number } | { ok: false; error: string }> {
  const delta = Math.trunc(Number(opts.delta) || 0);
  if (!delta) return { ok: false, error: "zero" };
  const ref = opts.ref == null || opts.ref === "" ? null : String(opts.ref);

  try {
    const balance = await prisma.$transaction(async (tx) => {
      if (ref) {
        const exists = await tx.bbCoinTx.findUnique({
          where: {
            userId_kind_ref: {
              userId: opts.userId,
              kind: opts.kind,
              ref,
            },
          },
        });
        if (exists) {
          const u = await tx.user.findUnique({
            where: { id: opts.userId },
            select: { bbCoins: true },
          });
          return Math.max(0, Number(u?.bbCoins) || 0);
        }
      }

      const u = await tx.user.findUnique({
        where: { id: opts.userId },
        select: { bbCoins: true },
      });
      if (!u) throw new Error("user");
      const cur = Math.max(0, Number(u.bbCoins) || 0);
      const next = cur + delta;
      if (next < 0) throw new Error("insufficient");
      await tx.user.update({
        where: { id: opts.userId },
        data: { bbCoins: next },
      });
      await tx.bbCoinTx.create({
        data: {
          userId: opts.userId,
          delta,
          balanceAfter: next,
          kind: opts.kind,
          ref,
          note: opts.note || null,
        },
      });
      return next;
    });
    return { ok: true, balance };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "fail";
    if (msg === "insufficient") return { ok: false, error: "insufficient" };
    if (msg.includes("Unique constraint")) {
      const bal = await getBbCoinBalance(opts.userId);
      return { ok: true, balance: bal };
    }
    return { ok: false, error: msg };
  }
}

export async function creditBbCoins(opts: {
  userId: string;
  amount: number;
  kind: string;
  ref?: string | null;
  note?: string | null;
}) {
  const amount = Math.max(0, Math.trunc(Number(opts.amount) || 0));
  if (!amount) return { ok: false as const, error: "zero" };
  return applyDelta({ ...opts, delta: amount });
}

export async function debitBbCoins(opts: {
  userId: string;
  amount: number;
  kind: string;
  ref?: string | null;
  note?: string | null;
}) {
  const amount = Math.max(0, Math.trunc(Number(opts.amount) || 0));
  if (!amount) return { ok: false as const, error: "zero" };
  return applyDelta({ ...opts, delta: -amount });
}

/**
 * Зачислить BB Coins за верные прогнозы турнира (1 раз на турнир).
 * Сумма = correct * BET_POINTS (как старые BB Points).
 */
export async function ensureTournamentBbCoinGrant(opts: {
  userId: string;
  tournamentId: string;
  correctAnswers: number;
}): Promise<{ granted: number; balance: number }> {
  const correct = Math.max(0, Math.trunc(Number(opts.correctAnswers) || 0));
  const amount = correct * BET_POINTS;
  if (!amount) {
    return { granted: 0, balance: await getBbCoinBalance(opts.userId) };
  }
  const res = await creditBbCoins({
    userId: opts.userId,
    amount,
    kind: "tournament_grant",
    ref: opts.tournamentId,
    note: `Прогнозы: ${correct}×${BET_POINTS} BB Coins`,
  });
  if (!res.ok) return { granted: 0, balance: await getBbCoinBalance(opts.userId) };
  return { granted: amount, balance: res.balance };
}
