import { prisma } from "@/lib/prisma";
import {
  attendanceCanonStartUtc,
  eveningWindowOverlapMinutes,
  trainingDayMarksFromSessions,
  trainingDayVisitBoundsFromSessions,
  trainingDayYmd,
} from "@/lib/squadSessions";
import {
  isTrainingServerKey,
  type TrainingServerKey,
} from "@/lib/squadServers";
import { reserveDaysForUser } from "@/lib/reserve";

const LIST_LIMIT = 80;

export type TrainingLaneStats = {
  sessions: {
    id: string;
    joinedAt: Date;
    leftAt: Date | null;
    nickAtJoin: string | null;
    serverKey: string;
  }[];
  presentDays: string[];
  lateDays: string[];
  reserveDays: string[];
  visitBounds: Record<string, { joinHm: string; leaveHm: string | null }>;
  minutes30d: number;
  sessions30d: number;
  openNow: boolean;
};

function laneFromSessions(
  lean: TrainingLaneStats["sessions"],
  reserveDays: string[],
  since: Date,
  serverFilter?: TrainingServerKey
): TrainingLaneStats {
  const filtered = serverFilter
    ? lean.filter(
        (s) => (s.serverKey || "").toUpperCase() === serverFilter
      )
    : lean.filter((s) => isTrainingServerKey(s.serverKey));

  const forAtt = filtered.map((s) => ({
    joinedAt: s.joinedAt,
    leftAt: s.leftAt,
    serverKey: s.serverKey,
  }));

  const marks = trainingDayMarksFromSessions(forAtt);
  const visitBoundsMap = trainingDayVisitBoundsFromSessions(forAtt);
  const visitBounds: Record<string, { joinHm: string; leaveHm: string | null }> =
    {};
  for (const [day, b] of visitBoundsMap) {
    visitBounds[day] = b;
  }

  const eveningMinsByDay = new Map<string, number>();
  for (const s of filtered) {
    if (s.joinedAt < since) continue;
    const mins = eveningWindowOverlapMinutes(s.joinedAt, s.leftAt);
    if (mins <= 0) continue;
    const day = trainingDayYmd(s.joinedAt);
    eveningMinsByDay.set(day, (eveningMinsByDay.get(day) || 0) + mins);
  }

  return {
    sessions: filtered.slice(0, LIST_LIMIT),
    presentDays: [...marks.present],
    lateDays: [...marks.late],
    reserveDays: serverFilter === "TR2" ? [] : reserveDays,
    visitBounds,
    minutes30d: [...eveningMinsByDay.values()].reduce((a, b) => a + b, 0),
    sessions30d: eveningMinsByDay.size,
    openNow: filtered.some((s) => s.leftAt == null),
  };
}

export async function loadUserTrainingStats(userId: string) {
  const canonStart = attendanceCanonStartUtc();
  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const since = since30 > canonStart ? since30 : canonStart;

  const [lean, reserveDays] = await Promise.all([
    prisma.squadServerSession.findMany({
      where: { userId, joinedAt: { gte: canonStart } },
      orderBy: { joinedAt: "desc" },
      select: {
        id: true,
        joinedAt: true,
        leftAt: true,
        nickAtJoin: true,
        serverKey: true,
      },
    }),
    reserveDaysForUser(userId),
  ]);

  const combined = laneFromSessions(lean, reserveDays, since);
  const tr1 = laneFromSessions(lean, reserveDays, since, "TR1");
  const tr2 = laneFromSessions(lean, reserveDays, since, "TR2");

  return {
    ...combined,
    tr1,
    tr2,
  };
}
