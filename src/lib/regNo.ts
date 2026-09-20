import { prisma } from "@/lib/prisma";

/**
 * Постоянный номер регистрации.
 * Выдаётся один раз при завершении анкеты; при удалении пользователя не переиспользуется.
 */
export async function assignRegNoIfNeeded(userId: string): Promise<number | null> {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, regNo: true, profileComplete: true },
    });
    if (!user || !user.profileComplete) return null;
    if (user.regNo != null) return user.regNo;

    const agg = await tx.user.aggregate({ _max: { regNo: true } });
    const next = (agg._max.regNo ?? 0) + 1;
    const updated = await tx.user.update({
      where: { id: userId },
      data: { regNo: next },
      select: { regNo: true },
    });
    return updated.regNo;
  });
}

/** Разовая выдача номеров всем с завершённой анкетой без regNo (по createdAt). */
export async function backfillRegNos(): Promise<{ assigned: number; max: number }> {
  const users = await prisma.user.findMany({
    where: { profileComplete: true, regNo: null },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  let assigned = 0;
  for (const u of users) {
    const n = await assignRegNoIfNeeded(u.id);
    if (n != null) assigned += 1;
  }

  const agg = await prisma.user.aggregate({ _max: { regNo: true } });
  return { assigned, max: agg._max.regNo ?? 0 };
}
