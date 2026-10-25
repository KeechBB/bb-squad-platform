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
import { dayOffDaysForUser } from "@/lib/dayOff";
import {
  attendancePublishedUntilUtc,
  clipSessionsToPublishedUntil,
} from "@/lib/attendancePublish";

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
  dayOffDays: string[];
  visitBounds: Record<string, { joinHm: string; leaveHm: string | null }>;
  minutes30d: number;
  sessions30d: number;
  openNow: boolean;
};

function laneFromSessions(
  lean: TrainingLaneStats["sessions"],
  reserveDays: string[],
  dayOffDays: string[],
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
    dayOffDays: serverFilter === "TR2" ? [] : dayOffDays,
    visitBounds,
    minutes30d: [...eveningMinsByDay.values()].reduce((a, b) => a + b, 0),
    sessions30d: eveningMinsByDay.size,
    openNow: filtered.some((s) => s.leftAt == null),
  };
}

export type LoadTrainingStatsOpts = {
  /**
   * Site (non-admin): clip to last MSK :00 boundary so mid-hour joins
   * do not appear until the hourly publish. Default true.
   */
  publicFreeze?: boolean;
};

export async function loadUserTrainingStats(
  userId: string,
  opts: LoadTrainingStatsOpts = {}
) {
  const publicFreeze = opts.publicFreeze !== false;
  const canonStart = attendanceCanonStartUtc();
  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const since = since30 > canonStart ? since30 : canonStart;
  const until = publicFreeze ? attendancePublishedUntilUtc() : null;

  const [leanRaw, reserveDays, dayOffDays] = await Promise.all([
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
    dayOffDaysForUser(userId),
  ]);

  const lean = until
    ? clipSessionsToPublishedUntil(leanRaw, until)
    : leanRaw;

  const combined = laneFromSessions(lean, reserveDays, dayOffDays, since);
  const tr1 = laneFromSessions(lean, reserveDays, dayOffDays, since, "TR1");
  const tr2 = laneFromSessions(lean, reserveDays, dayOffDays, since, "TR2");

  // Online badge stays live (plaza session); calendar marks use freeze clip above.
  const openLive = (key?: TrainingServerKey) =>
    leanRaw.some(
      (s) =>
        s.leftAt == null &&
        (key
          ? (s.serverKey || "").toUpperCase() === key
          : isTrainingServerKey(s.serverKey))
    );

  return {
    ...combined,
    openNow: openLive(),
    tr1: { ...tr1, openNow: openLive("TR1") },
    tr2: { ...tr2, openNow: openLive("TR2") },
  };
}
