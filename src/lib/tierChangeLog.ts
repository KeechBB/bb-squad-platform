import { prisma } from "@/lib/prisma";
import { personLabel, writeActionLog } from "@/lib/actionLog";

export type TierChangeSeed = {
  nick: string;
  fromTier: number;
  toTier: number;
  note?: string;
};

/** Повышения 2026-10-02 (канон: sostav/osnovnoj-sostav.md). */
export const TIER_SEED_2026_10_02: TierChangeSeed[] = [
  { nick: "AkiN", fromTier: 2, toTier: 1 },
  { nick: "KillReal", fromTier: 2, toTier: 1 },
  { nick: "Tankist", fromTier: 3, toTier: 2 },
  { nick: "freak", fromTier: 3, toTier: 2 },
  { nick: "Radislave", fromTier: 3, toTier: 2 },
  { nick: "Kroasawn", fromTier: 3, toTier: 2 },
  { nick: "VET", fromTier: 3, toTier: 2 },
  { nick: "MrChaykaa", fromTier: 3, toTier: 2 },
  { nick: "Barsik", fromTier: 3, toTier: 2 },
  { nick: "Otto", fromTier: 3, toTier: 2 },
  { nick: "Azure", fromTier: 3, toTier: 2 },
  { nick: "Trixx", fromTier: 3, toTier: 2 },
  {
    nick: "akin0v",
    fromTier: 4,
    toTier: 2,
    note: "Из тир 4 / резерва в тир 2",
  },
  { nick: "yanchik", fromTier: 4, toTier: 2, note: "Из тир 4 / вне среза" },
  { nick: "Forks", fromTier: 4, toTier: 3 },
  { nick: "ADUN", fromTier: 4, toTier: 3 },
  { nick: "Varyag", fromTier: 4, toTier: 3 },
];

const BATCH_2026_10_02 = "2026-10-02";
const BATCH_2026_10_02_GAD = "2026-10-02-gad-t2";

/** Полдень UTC ≈ 15:00 МСК — стабильная «дата без времени» для пакета. */
function dayNoonUtc(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

export function tierLabel(t: number): string {
  if (t === 1) return "Тир 1";
  if (t === 2) return "Тир 2";
  if (t === 3) return "Тир 3";
  return "Тир 4 / вне";
}

export function formatTierMove(fromTier: number, toTier: number): string {
  return `${tierLabel(fromTier)} → ${tierLabel(toTier)}`;
}

/** Идемпотентно заливает известные пакеты переводов. */
export async function ensureTierChangeSeeds(): Promise<number> {
  let inserted = 0;

  const existingPromo = await prisma.tierChangeLog.count({
    where: { batchKey: BATCH_2026_10_02 },
  });
  if (existingPromo === 0) {
    const changedAt = dayNoonUtc(BATCH_2026_10_02);
    const noteDefault = "Пакет повышений ORR / КВ / сентябрьские бои";

    await prisma.tierChangeLog.createMany({
      data: TIER_SEED_2026_10_02.map((row) => ({
        changedAt,
        nick: row.nick,
        fromTier: row.fromTier,
        toTier: row.toTier,
        note: row.note || noteDefault,
        batchKey: BATCH_2026_10_02,
        actorNick: "система",
      })),
      skipDuplicates: true,
    });
    inserted += TIER_SEED_2026_10_02.length;
  }

  const existingGad = await prisma.tierChangeLog.count({
    where: { batchKey: BATCH_2026_10_02_GAD },
  });
  if (existingGad === 0) {
    await prisma.tierChangeLog.create({
      data: {
        changedAt: dayNoonUtc(BATCH_2026_10_02),
        nick: "GAD",
        fromTier: 1,
        toTier: 2,
        note: "Активность — капитан, не брать в Тир 1 на данный момент",
        batchKey: BATCH_2026_10_02_GAD,
        actorNick: "система",
      },
    });
    inserted += 1;
  }

  return inserted;
}

export async function recordTierChange(input: {
  nick: string;
  fromTier: number;
  toTier: number;
  changedAt: Date;
  note?: string | null;
  actorId?: string | null;
  actorNick?: string | null;
  batchKey?: string | null;
}) {
  const nick = input.nick.trim();
  const row = await prisma.tierChangeLog.create({
    data: {
      nick,
      fromTier: input.fromTier,
      toTier: input.toTier,
      changedAt: input.changedAt,
      note: input.note?.trim() || null,
      batchKey: input.batchKey || null,
      actorId: input.actorId ?? null,
      actorNick: input.actorNick ?? null,
    },
  });

  await writeActionLog({
    category: "admin",
    action: "tier_change",
    message: `${input.actorNick || "админ"}: ${nick} ${formatTierMove(
      input.fromTier,
      input.toTier
    )}`,
    actorId: input.actorId,
    actorNick: input.actorNick,
    targetNick: nick,
    meta: {
      fromTier: input.fromTier,
      toTier: input.toTier,
      note: input.note || null,
      changedAt: input.changedAt.toISOString(),
    },
    createdAt: input.changedAt,
  });

  return row;
}

export { personLabel };
