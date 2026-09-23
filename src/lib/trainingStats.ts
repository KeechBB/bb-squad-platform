import { prisma } from "@/lib/prisma";
import {
  attendanceCanonStartUtc,
  eveningWindowOverlapMinutes,
  trainingDayMarksFromSessions,
  trainingDayVisitBoundsFromSessions,
  trainingDayYmd,
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

  const marks = trainingDayMarksFromSessions(forAtt);
  const presentDays = [...marks.present];
  const lateDays = [...marks.late];
  const visitBoundsMap = trainingDayVisitBoundsFromSessions(forAtt);
  const visitBounds: Record<string, { joinHm: string; leaveHm: string | null }> =
    {};
  for (const [day, b] of visitBoundsMap) {
    visitBounds[day] = b;
  }

  const sessions = lean.slice(0, LIST_LIMIT);

  /** Минуты в окне 21:00–00:00 МСК на TR1 по дням тренировки (за 30 дн) */
  const eveningMinsByDay = new Map<string, number>();
  for (const s of lean) {
    if (s.joinedAt < since) continue;
    if ((s.serverKey || "").toUpperCase() !== "TR1") continue;
    const mins = eveningWindowOverlapMinutes(s.joinedAt, s.leftAt);
    if (mins <= 0) continue;
    const day = trainingDayYmd(s.joinedAt);
    eveningMinsByDay.set(day, (eveningMinsByDay.get(day) || 0) + mins);
  }
  const minutes30d = [...eveningMinsByDay.values()].reduce((a, b) => a + b, 0);
  /** Вечера с ненулевым временем в окне 21:00–00:00 */
  const sessions30d = eveningMinsByDay.size;
  const openNow = lean.some(
    (s) => s.leftAt == null && (s.serverKey || "").toUpperCase() === "TR1"
  );

  return {
    sessions,
    presentDays,
    lateDays,
    visitBounds,
    minutes30d,
    sessions30d,
    openNow,
  };
}
