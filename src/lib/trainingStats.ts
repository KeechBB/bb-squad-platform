import { prisma } from "@/lib/prisma";
import {
  attendanceCanonStartUtc,
  formatDurationMinutes,
  presentTrainingDaysFromSessions,
  trainingDayVisitBoundsFromSessions,
} from "@/lib/squadSessions";

const LIST_LIMIT = 80;

export async function loadUserTrainingStats(userId: string) {
  const canonStart = attendanceCanonStartUtc();
  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const since = since30 > canonStart ? since30 : canonStart;

  const lean = await prisma.squadServerSession.findMany({
    where: { userId, joinedAt: { gte: canonStart } },
    orderBy: { joinedAt: "desc" },
    select: {
      id: true,
      joinedAt: true,
      leftAt: true,
      nickAtJoin: true,
      serverKey: true,
    },
  });

  const forAtt = lean.map((s) => ({
    joinedAt: s.joinedAt,
    leftAt: s.leftAt,
    serverKey: s.serverKey,
  }));

  const presentDays = [...presentTrainingDaysFromSessions(forAtt)];
  const visitBoundsMap = trainingDayVisitBoundsFromSessions(forAtt);
  const visitBounds: Record<string, { joinHm: string; leaveHm: string | null }> =
    {};
  for (const [day, b] of visitBoundsMap) {
    visitBounds[day] = b;
  }

  const sessions = lean.slice(0, LIST_LIMIT);
  const last30 = lean.filter((s) => s.joinedAt >= since);
  const minutes30d = last30.reduce(
    (sum, s) => sum + formatDurationMinutes(s.joinedAt, s.leftAt),
    0
  );
  const openNow = lean.some((s) => s.leftAt == null);

  return {
    sessions,
    presentDays,
    visitBounds,
    minutes30d,
    sessions30d: last30.length,
    openNow,
  };
}
