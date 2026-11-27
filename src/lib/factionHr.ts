/**
 * Контракты (месячная бронь) и зарплаты % от гринда.
 * ЗП падает при settle ночных ставок (01:00 МСК или ручное закрытие).
 */
import { prisma } from "@/lib/prisma";
import { BD_MARK } from "@/lib/blueberryDollar";
import type { NightBetWindowBounds } from "@/lib/factionNightBets";

export const SALARY_PRESETS = [10, 20, 30, 40, 50, 60, 70] as const;
export type SalaryPct = (typeof SALARY_PRESETS)[number] | 0;

export const CONTRACT_DAYS = 30;

export function isSalaryPct(n: number): n is SalaryPct {
  return n === 0 || (SALARY_PRESETS as readonly number[]).includes(n);
}

export async function expireDueContracts(now = new Date()) {
  await prisma.factionPlayerContract.updateMany({
    where: { status: "ACTIVE", endsAt: { lte: now } },
    data: { status: "EXPIRED" },
  });
}

/** Активный контракт блокирует выход игрока за свои B$. */
export async function activeContractForUser(userId: string, now = new Date()) {
  await expireDueContracts(now);
  return prisma.factionPlayerContract.findFirst({
    where: {
      userId,
      status: "ACTIVE",
      endsAt: { gt: now },
    },
    orderBy: { endsAt: "desc" },
  });
}

export async function assertCanSelfLeaveFaction(userId: string): Promise<{
  ok: true;
} | { ok: false; error: string }> {
  const c = await activeContractForUser(userId);
  if (!c) return { ok: true };
  const until = c.endsAt.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  return {
    ok: false,
    error: `contract_active:${until}`,
  };
}

export async function signMonthContract(opts: {
  factionId: string;
  userId: string;
  signedByUserId: string;
  costBd: number;
  note?: string | null;
}): Promise<{ ok: true; contractId: string; endsAt: string } | { ok: false; error: string }> {
  const cost = Math.max(0, Math.round(opts.costBd));
  if (cost < 1) return { ok: false, error: "bad_cost" };

  await expireDueContracts();

  const member = await prisma.factionMember.findFirst({
    where: { factionId: opts.factionId, userId: opts.userId },
    select: { id: true },
  });
  if (!member) return { ok: false, error: "not_member" };

  const existing = await prisma.factionPlayerContract.findFirst({
    where: {
      userId: opts.userId,
      status: "ACTIVE",
      endsAt: { gt: new Date() },
    },
  });
  if (existing) return { ok: false, error: "already_contracted" };

  const faction = await prisma.faction.findUnique({
    where: { id: opts.factionId },
    select: { blueberryBalance: true },
  });
  if (!faction) return { ok: false, error: "faction_missing" };
  if (faction.blueberryBalance < cost) return { ok: false, error: "treasury_low" };

  const startsAt = new Date();
  const endsAt = new Date(startsAt.getTime() + CONTRACT_DAYS * 24 * 60 * 60 * 1000);
  const sourceKey = `contract_fee:${opts.factionId}:${opts.userId}:${startsAt.toISOString()}`;

  try {
    const contract = await prisma.$transaction(async (tx) => {
      const fresh = await tx.faction.findUnique({
        where: { id: opts.factionId },
        select: { blueberryBalance: true },
      });
      if (!fresh || fresh.blueberryBalance < cost) {
        throw new Error("treasury_low");
      }
      await tx.faction.update({
        where: { id: opts.factionId },
        data: { blueberryBalance: { decrement: cost } },
      });
      await tx.factionLedgerEntry.create({
        data: {
          factionId: opts.factionId,
          amount: -cost,
          kind: "contract_fee",
          sourceKey,
          note: `Контракт на месяц (−${cost.toLocaleString("ru-RU")} ${BD_MARK})`,
          userId: opts.userId,
        },
      });
      return tx.factionPlayerContract.create({
        data: {
          factionId: opts.factionId,
          userId: opts.userId,
          signedByUserId: opts.signedByUserId,
          costBd: cost,
          startsAt,
          endsAt,
          status: "ACTIVE",
          note: opts.note || null,
        },
      });
    });
    return {
      ok: true,
      contractId: contract.id,
      endsAt: contract.endsAt.toISOString(),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "treasury_low") return { ok: false, error: "treasury_low" };
    if (String(e).includes("Unique constraint")) return { ok: false, error: "dup" };
    console.error("signMonthContract", e);
    return { ok: false, error: "failed" };
  }
}

export async function cancelContract(opts: {
  contractId: string;
  factionId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const c = await prisma.factionPlayerContract.findFirst({
    where: { id: opts.contractId, factionId: opts.factionId, status: "ACTIVE" },
  });
  if (!c) return { ok: false, error: "not_found" };
  await prisma.factionPlayerContract.update({
    where: { id: c.id },
    data: { status: "CANCELLED" },
  });
  return { ok: true };
}

export async function setPlayerSalaryPct(opts: {
  factionId: string;
  userId: string;
  pct: number;
  updatedBy: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSalaryPct(opts.pct)) return { ok: false, error: "bad_pct" };
  const member = await prisma.factionMember.findFirst({
    where: { factionId: opts.factionId, userId: opts.userId },
    select: { id: true },
  });
  if (!member) return { ok: false, error: "not_member" };

  await prisma.factionPlayerSalary.upsert({
    where: {
      factionId_userId: { factionId: opts.factionId, userId: opts.userId },
    },
    create: {
      factionId: opts.factionId,
      userId: opts.userId,
      pct: opts.pct,
      updatedBy: opts.updatedBy,
    },
    update: {
      pct: opts.pct,
      updatedBy: opts.updatedBy,
    },
  });
  return { ok: true };
}

/**
 * Выплата ЗП за окно ночи: % от гринда игрока → личный B$, списание с казны.
 * Идемпотентно по sourceKey.
 */
export async function paySalariesForNightWindow(
  bounds: NightBetWindowBounds,
): Promise<{ paid: number; skipped: number }> {
  const salaries = await prisma.factionPlayerSalary.findMany({
    where: { pct: { gt: 0 } },
  });
  if (!salaries.length) return { paid: 0, skipped: 0 };

  const factionIds = [...new Set(salaries.map((s) => s.factionId))];
  const userIds = [...new Set(salaries.map((s) => s.userId))];

  const grindRows = await prisma.factionLedgerEntry.groupBy({
    by: ["factionId", "userId"],
    where: {
      factionId: { in: factionIds },
      userId: { in: userIds },
      kind: "grind",
      amount: { gt: 0 },
      createdAt: { gte: bounds.grindStart, lt: bounds.grindEnd },
    },
    _sum: { amount: true },
  });
  const grindKey = (f: string, u: string) => `${f}:${u}`;
  const grindMap = new Map<string, number>();
  for (const r of grindRows) {
    if (!r.userId) continue;
    grindMap.set(grindKey(r.factionId, r.userId), Math.max(0, r._sum.amount || 0));
  }

  let paid = 0;
  let skipped = 0;

  for (const s of salaries) {
    const grindBd = grindMap.get(grindKey(s.factionId, s.userId)) || 0;
    const paidBd = Math.floor((grindBd * s.pct) / 100);
    if (paidBd < 1) {
      skipped += 1;
      continue;
    }
    const sourceKey = `salary:${bounds.id}:${s.userId}`;
    try {
      await prisma.$transaction(async (tx) => {
        const exists = await tx.factionSalaryPayout.findUnique({
          where: { sourceKey },
        });
        if (exists) return;

        const fac = await tx.faction.findUnique({
          where: { id: s.factionId },
          select: { blueberryBalance: true },
        });
        if (!fac || fac.blueberryBalance < paidBd) {
          throw new Error("treasury_low");
        }

        await tx.faction.update({
          where: { id: s.factionId },
          data: { blueberryBalance: { decrement: paidBd } },
        });
        await tx.user.update({
          where: { id: s.userId },
          data: { blueberryBalance: { increment: paidBd } },
        });
        await tx.factionLedgerEntry.create({
          data: {
            factionId: s.factionId,
            amount: -paidBd,
            kind: "salary_out",
            sourceKey: `salary_ledger:${bounds.id}:${s.userId}`,
            note: `Зарплата ${s.pct}% (−${paidBd.toLocaleString("ru-RU")} ${BD_MARK}, ночь ${bounds.id})`,
            userId: s.userId,
          },
        });
        await tx.factionSalaryPayout.create({
          data: {
            factionId: s.factionId,
            userId: s.userId,
            windowId: bounds.id,
            pct: s.pct,
            grindBd,
            paidBd,
            sourceKey,
          },
        });
      });
      paid += 1;
    } catch (e) {
      skipped += 1;
      if (!(e instanceof Error && e.message === "treasury_low")) {
        console.error("paySalariesForNightWindow", s.userId, e);
      }
    }
  }

  return { paid, skipped };
}
