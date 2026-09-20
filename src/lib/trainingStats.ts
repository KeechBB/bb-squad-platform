import { prisma } from "@/lib/prisma";
import {
  attendanceCanonStartUtc,
  formatDurationMinutes,
} from "@/lib/squadSessions";

export async function loadUserTrainingStats(userId: string) {
  const canonStart = attendanceCanonStartUtc();
  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const since = since30 > canonStart ? since30 : canonStart;
  const sessions = await prisma.squadServerSession.findMany({
    where: { userId, joinedAt: { gte: canonStart } },
    orderBy: { joinedAt: "desc" },
    // Без лимита: календарь профиля должен видеть те же дни, что и админка.
  });

  const last30 = sessions.filter((s) => s.joinedAt >= since);
  const minutes30d = last30.reduce(
    (sum, s) => sum + formatDurationMinutes(s.joinedAt, s.leftAt),
    0
  );
  const openNow = sessions.some((s) => s.leftAt == null);

  return {
    sessions,
    minutes30d,
    sessions30d: last30.length,
    openNow,
  };
}
