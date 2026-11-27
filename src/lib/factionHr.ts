/**
 * Контракты (месячная бронь) и зарплаты % от гринда.
 * ЗП падает при settle ночных ставок (01:00 МСК или ручное закрытие).
 * При подписи: 20% стоимости → личный B$ игрока + письмо от фракции.
 * После каждой выплаты ЗП — письмо от «Штаб · {фракция}».
 */
import { prisma } from "@/lib/prisma";
import { BD_MARK } from "@/lib/blueberryDollar";
import type { NightBetWindowBounds } from "@/lib/factionNightBets";

export const SALARY_PRESETS = [10, 20, 30, 40, 50, 60, 70] as const;
export type SalaryPct = (typeof SALARY_PRESETS)[number] | 0;

/** Срок контракта — 30 календарных дней. */
export const CONTRACT_DAYS = 30;
/** Доля стоимости контракта на личный баланс игрока при подписи. */
export const CONTRACT_PLAYER_CUT_RATIO = 0.2;

export function isSalaryPct(n: number): n is SalaryPct {
  return n === 0 || (SALARY_PRESETS as readonly number[]).includes(n);
}

/** +N календарных дней (локальная дата объекта Date). */
export function addCalendarDays(from: Date, days: number): Date {
  const d = new Date(from.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

function fmtRuDate(d: Date): string {
  return d.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export async function expireDueContracts(now = new Date()) {
  await prisma.factionPlayerContract.updateMany({
    where: { status: "ACTIVE", endsAt: { lte: now } },
    data: { status: "EXPIRED" },
  });
}

/** Активный контракт блокирует выход игрока за свои B$ и сезонный межсезон. */
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

function contractUntilLabel(endsAt: Date): string {
  return endsAt.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export async function assertCanSelfLeaveFaction(userId: string): Promise<{
  ok: true;
} | { ok: false; error: string }> {
  const c = await activeContractForUser(userId);
  if (!c) return { ok: true };
  return {
    ok: false,
    error: `contract_active:${contractUntilLabel(c.endsAt)}`,
  };
}

/** Контрактная бронь: нельзя выставлять на межсезонный аукцион. */
export async function assertCanSeasonTransfer(userId: string): Promise<{
  ok: true;
} | { ok: false; error: string; until: string }> {
  const c = await activeContractForUser(userId);
  if (!c) return { ok: true };
  const until = contractUntilLabel(c.endsAt);
  return {
    ok: false,
    error: `contract_active:${until}`,
    until,
  };
}

export async function signMonthContract(opts: {
  factionId: string;
  userId: string;
  signedByUserId: string;
  costBd: number;
  note?: string | null;
}): Promise<
  | { ok: true; contractId: string; endsAt: string; playerCutBd: number }
  | { ok: false; error: string }
> {
  const cost = Math.max(0, Math.round(opts.costBd));
  if (cost < 1) return { ok: false, error: "bad_cost" };
  const playerCut = Math.max(0, Math.floor(cost * CONTRACT_PLAYER_CUT_RATIO));

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
    select: { blueberryBalance: true, name: true },
  });
  if (!faction) return { ok: false, error: "faction_missing" };
  if (faction.blueberryBalance < cost) return { ok: false, error: "treasury_low" };

  const startsAt = new Date();
  const endsAt = addCalendarDays(startsAt, CONTRACT_DAYS);
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
      if (playerCut > 0) {
        await tx.user.update({
          where: { id: opts.userId },
          data: { blueberryBalance: { increment: playerCut } },
        });
      }
      await tx.factionLedgerEntry.create({
        data: {
          factionId: opts.factionId,
          amount: -cost,
          kind: "contract_fee",
          sourceKey,
          note:
            playerCut > 0
              ? `Контракт на ${CONTRACT_DAYS} дн. (−${cost.toLocaleString("ru-RU")} ${BD_MARK}; игроку 20% = ${playerCut.toLocaleString("ru-RU")} ${BD_MARK})`
              : `Контракт на ${CONTRACT_DAYS} дн. (−${cost.toLocaleString("ru-RU")} ${BD_MARK})`,
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

    await mailContractSigned({
      authorId: opts.signedByUserId,
      recipientId: opts.userId,
      factionName: faction.name,
      costBd: cost,
      playerCutBd: playerCut,
      startsAt,
      endsAt,
      sourceKey: `contract_mail:${contract.id}`,
    });

    return {
      ok: true,
      contractId: contract.id,
      endsAt: contract.endsAt.toISOString(),
      playerCutBd: playerCut,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "treasury_low") return { ok: false, error: "treasury_low" };
    if (String(e).includes("Unique constraint")) return { ok: false, error: "dup" };
    console.error("signMonthContract", e);
    return { ok: false, error: "failed" };
  }
}

async function mailContractSigned(opts: {
  authorId: string;
  recipientId: string;
  factionName: string;
  costBd: number;
  playerCutBd: number;
  startsAt: Date;
  endsAt: Date;
  sourceKey: string;
}) {
  const costLabel = opts.costBd.toLocaleString("ru-RU");
  const cutLabel = opts.playerCutBd.toLocaleString("ru-RU");
  const fromLabel = fmtRuDate(opts.startsAt);
  const untilLabel = fmtRuDate(opts.endsAt);
  const body = [
    `Фракция «${opts.factionName}» подписала с тобой контракт.`,
    "",
    "Что это такое",
    `Контракт — месячная бронь игрока за фракцией. Стоимость контракта равна оценке игрока на момент подписи: ${costLabel} ${BD_MARK}.`,
    `Эти деньги списываются с казны фракции. Тебе на личный баланс сразу приходит 20% от этой суммы: ${cutLabel} ${BD_MARK}.`,
    "",
    "Что теперь будет",
    `• Срок: ${CONTRACT_DAYS} календарных дней — с ${fromLabel} по ${untilLabel} включительно.`,
    "• До конца срока ты не можешь сам выйти из фракции за свои B$ (бронь держит состав).",
    "• Пока контракт жив, тебя нельзя выставить на межсезонный трансферный аукцион (сезонное окно).",
    "• Фракция может назначить тебе % зарплаты от гринда — выплаты идут на личный B$ после ночного окна (около 01:00 МСК).",
    "• После окончания контракта бронь снимается; выход за свои B$ и участие в межсезоне снова доступны, если не подпишут новый.",
    "",
    "Если вопросы по контракту — пиши лидеру или заместителю фракции.",
    "",
    `— ${opts.factionName}`,
  ].join("\n");

  try {
    await prisma.profileMail.create({
      data: {
        title: `Контракт · ${opts.factionName} · ${CONTRACT_DAYS} дней`,
        body,
        senderKind: "faction",
        senderLabel: `Штаб · ${opts.factionName}`,
        tags: ["Контракт", "Фракции"],
        sourceKey: opts.sourceKey,
        authorId: opts.authorId,
        recipients: { create: [{ userId: opts.recipientId }] },
      },
    });
  } catch (e) {
    if (String(e).includes("Unique constraint")) return;
    console.error("contract mail failed", e);
  }
}

async function salaryMailAuthorId(): Promise<string | null> {
  const u = await prisma.user.findFirst({
    where: { steamId: "76561198028435874" },
    select: { id: true },
  });
  if (u) return u.id;
  const byNick = await prisma.user.findFirst({
    where: { nick: { equals: "Keech", mode: "insensitive" } },
    select: { id: true },
  });
  return byNick?.id || null;
}

/** Письмо игроку после начисления зарплаты — от штаба фракции. */
async function mailSalaryPaid(opts: {
  authorId: string;
  recipientId: string;
  factionName: string;
  pct: number;
  grindBd: number;
  paidBd: number;
  windowId: string;
  sourceKey: string;
}) {
  const paidLabel = opts.paidBd.toLocaleString("ru-RU");
  const grindLabel = opts.grindBd.toLocaleString("ru-RU");
  const body = [
    `Штаб фракции «${opts.factionName}» начислил тебе зарплату.`,
    "",
    `Ночь тренировки: ${opts.windowId}`,
    `Твой гринд за окно: ${grindLabel} ${BD_MARK}`,
    `Ставка зарплаты: ${opts.pct}%`,
    `На личный баланс зачислено: ${paidLabel} ${BD_MARK}`,
    "",
    "Деньги уже на личном B$. Проверить можно в профиле / балансах.",
    "",
    `— Штаб · ${opts.factionName}`,
  ].join("\n");

  try {
    await prisma.profileMail.create({
      data: {
        title: `Зарплата · ${opts.factionName} · +${paidLabel} ${BD_MARK}`,
        body,
        senderKind: "faction",
        senderLabel: `Штаб · ${opts.factionName}`,
        tags: ["Зарплата", "Фракции"],
        sourceKey: opts.sourceKey,
        authorId: opts.authorId,
        recipients: { create: [{ userId: opts.recipientId }] },
      },
    });
  } catch (e) {
    if (String(e).includes("Unique constraint")) return;
    console.error("salary mail failed", e);
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

  const factions = await prisma.faction.findMany({
    where: { id: { in: factionIds } },
    select: { id: true, name: true },
  });
  const nameBy = new Map(factions.map((f) => [f.id, f.name]));
  const authorId = await salaryMailAuthorId();

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
    let didPay = false;
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
        didPay = true;
      });
      if (didPay) {
        paid += 1;
        const factionName = nameBy.get(s.factionId) || "Фракция";
        if (authorId) {
          await mailSalaryPaid({
            authorId,
            recipientId: s.userId,
            factionName,
            pct: s.pct,
            grindBd,
            paidBd,
            windowId: bounds.id,
            sourceKey: `salary_mail:${bounds.id}:${s.userId}`,
          });
        }
      } else {
        skipped += 1;
      }
    } catch (e) {
      skipped += 1;
      if (!(e instanceof Error && e.message === "treasury_low")) {
        console.error("paySalariesForNightWindow", s.userId, e);
      }
    }
  }

  return { paid, skipped };
}
