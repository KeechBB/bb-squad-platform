/**
 * Живой котёл кейса. Пол кейса копится отдельно:
 * траты BBC → джекпот Первого Плода, траты $ → джекпот Жатвы.
 * После выигрыша сумма возвращается к полу.
 */
import { prisma } from "@/lib/prisma";

export const CASE_JACKPOT_FLOOR = {
  BBC: 200_000,
  BD: 1_000_000,
} as const;

export type CaseJackpotCurrency = keyof typeof CASE_JACKPOT_FLOOR;

export type CaseJackpotPools = { BBC: number; BD: number };

function asAmount(value: unknown, fallback: number): number {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export async function readCaseJackpots(): Promise<CaseJackpotPools> {
  await prisma.$executeRaw`
    INSERT INTO "CaseJackpotPool" (currency, amount, "updatedAt")
    VALUES
      ('BBC', ${CASE_JACKPOT_FLOOR.BBC}, NOW()),
      ('BD', ${CASE_JACKPOT_FLOOR.BD}, NOW())
    ON CONFLICT (currency) DO NOTHING
  `;
  const rows = await prisma.$queryRaw<Array<{ currency: string; amount: number }>>`
    SELECT currency, amount::float8 AS amount FROM "CaseJackpotPool"
  `;
  const out: CaseJackpotPools = {
    BBC: CASE_JACKPOT_FLOOR.BBC,
    BD: CASE_JACKPOT_FLOOR.BD,
  };
  for (const row of rows) {
    if (row.currency === "BBC" || row.currency === "BD") {
      out[row.currency] = asAmount(row.amount, CASE_JACKPOT_FLOOR[row.currency]);
    }
  }
  return out;
}

/** Прибавить реальную трату к котлу этой валюты. Возвращает сумму после прибавки. */
export async function addCaseJackpot(
  currency: CaseJackpotCurrency,
  amount: number
): Promise<number> {
  const n = Math.trunc(amount);
  const floor = CASE_JACKPOT_FLOOR[currency];
  if (n <= 0) {
    const pools = await readCaseJackpots();
    return pools[currency];
  }
  const rows = await prisma.$queryRaw<Array<{ amount: number }>>`
    INSERT INTO "CaseJackpotPool" (currency, amount, "updatedAt")
    VALUES (${currency}, ${floor + n}, NOW())
    ON CONFLICT (currency) DO UPDATE
    SET amount = "CaseJackpotPool".amount + ${n},
        "updatedAt" = NOW()
    RETURNING amount::float8 AS amount
  `;
  return asAmount(rows[0]?.amount, floor + n);
}

/**
 * Забрать котёл и сразу вернуть его к полу.
 * Блокировка строки, чтобы два выигрыша не забрали одну и ту же сумму.
 */
export async function claimCaseJackpot(
  currency: CaseJackpotCurrency
): Promise<number> {
  const floor = CASE_JACKPOT_FLOOR[currency];
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO "CaseJackpotPool" (currency, amount, "updatedAt")
      VALUES (${currency}, ${floor}, NOW())
      ON CONFLICT (currency) DO NOTHING
    `;
    const rows = await tx.$queryRaw<Array<{ amount: number }>>`
      SELECT amount::float8 AS amount
      FROM "CaseJackpotPool"
      WHERE currency = ${currency}
      FOR UPDATE
    `;
    const payout = asAmount(rows[0]?.amount, floor);
    await tx.$executeRaw`
      UPDATE "CaseJackpotPool"
      SET amount = ${floor}, "updatedAt" = NOW()
      WHERE currency = ${currency}
    `;
    return payout;
  });
}

/** Вернуть котёл, если зачисление победителю не прошло, и пол ещё никто не пополнил. */
export async function restoreCaseJackpotIfFloor(
  currency: CaseJackpotCurrency,
  payout: number
): Promise<void> {
  const floor = CASE_JACKPOT_FLOOR[currency];
  const n = Math.trunc(payout);
  if (n <= floor) return;
  await prisma.$executeRaw`
    UPDATE "CaseJackpotPool"
    SET amount = ${n}, "updatedAt" = NOW()
    WHERE currency = ${currency} AND amount = ${floor}
  `;
}
