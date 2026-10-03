/**
 * PB1 / TPUB1 attendance for public-rating calendar.
 * Calendar day = MSK date of join (not training-evening day).
 * «Был» = любая сессия в этот день (нормы минут нет).
 */
import { prisma } from "@/lib/prisma";
import { isPublicServerKey } from "@/lib/squadServers";
import {
  ATTENDANCE_CANON_START_YMD,
  attendanceCanonStartUtc,
  mergeSessionsWithRejoinGap,
  mskParts,
  ymdFromMskParts,
  type DayVisitBounds,
  type SessionForAttendance,
} from "@/lib/squadSessions";

const LIST_LIMIT = 80;

export function calendarDayYmdMsk(d: Date): string {
  const p = mskParts(d);
  return ymdFromMskParts(p.y, p.m, p.day);
}

function hmMskFromDate(d: Date): string {
  const p = mskParts(d);
  return `${String(p.h).padStart(2, "0")}:${String(p.min).padStart(2, "0")}`;
}

export type PublicDayMarks = {
  present: Set<string>;
  /** join ≥21:00 МСК — жёлтый (как на тренировке, для единообразия календаря) */
  late: Set<string>;
};

export function publicDayMarksFromSessions(
  sessions: SessionForAttendance[],
  now = new Date()
): PublicDayMarks {
  const byDay = new Map<
    string,
    Array<{ joinedAt: Date; leftAt: Date | null }>
  >();
  for (const s of sessions) {
    const key = (s.serverKey || "").toUpperCase();
    if (key && !isPublicServerKey(key)) continue;
    const day = calendarDayYmdMsk(s.joinedAt);
    if (day < ATTENDANCE_CANON_START_YMD) continue;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push({ joinedAt: s.joinedAt, leftAt: s.leftAt });
  }

  const present = new Set<string>();
  const late = new Set<string>();
  const today = calendarDayYmdMsk(now);

  for (const [day, list] of byDay) {
    if (day > today) continue;
    if (!list.length) continue;
    present.add(day);
    const spans = mergeSessionsWithRejoinGap(list);
    const first = spans[0];
    if (first) {
      const p = mskParts(first.join);
      const mins = p.h * 60 + p.min;
      if (mins >= 21 * 60) late.add(day);
    }
  }
  return { present, late };
}

export function publicDayVisitBoundsFromSessions(
  sessions: SessionForAttendance[],
  now = new Date()
): Map<string, DayVisitBounds> {
  const byDay = new Map<string, Array<{ joinedAt: Date; leftAt: Date | null }>>();
  for (const s of sessions) {
    const key = (s.serverKey || "").toUpperCase();
    if (key && !isPublicServerKey(key)) continue;
    const day = calendarDayYmdMsk(s.joinedAt);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push({ joinedAt: s.joinedAt, leftAt: s.leftAt });
  }

  const out = new Map<string, DayVisitBounds>();
  for (const [day, list] of byDay) {
    const spans = mergeSessionsWithRejoinGap(list);
    if (!spans.length) continue;
    const first = spans[0];
    const last = spans[spans.length - 1];
    out.set(day, {
      joinHm: hmMskFromDate(first.join),
      leaveHm: last.leave ? hmMskFromDate(last.leave) : null,
    });
  }
  return out;
}

export async function loadUserPublicAttendanceStats(userId: string) {
  const canonStart = attendanceCanonStartUtc();
  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const since = since30 > canonStart ? since30 : canonStart;

  const lean = await prisma.squadServerSession.findMany({
    where: {
      userId,
      joinedAt: { gte: canonStart },
      serverKey: "TPUB1",
    },
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

  const marks = publicDayMarksFromSessions(forAtt);
  const presentDays = [...marks.present];
  const lateDays = [...marks.late];
  const visitBoundsMap = publicDayVisitBoundsFromSessions(forAtt);
  const visitBounds: Record<string, { joinHm: string; leaveHm: string | null }> =
    {};
  for (const [day, b] of visitBoundsMap) {
    visitBounds[day] = b;
  }

  const sessions = lean.slice(0, LIST_LIMIT);

  let minutes30d = 0;
  const days30 = new Set<string>();
  const now = new Date();
  for (const s of lean) {
    if (s.joinedAt < since) continue;
    const end = s.leftAt ?? now;
    minutes30d += Math.max(
      0,
      Math.round((end.getTime() - s.joinedAt.getTime()) / 60000)
    );
    days30.add(calendarDayYmdMsk(s.joinedAt));
  }

  const openNow = lean.some((s) => s.leftAt == null);

  return {
    sessions,
    presentDays,
    lateDays,
    visitBounds,
    minutes30d,
    sessions30d: days30.size,
    openNow,
  };
}

/** Leaderboard by PB1 days present (for /public until combat RP ledger is ready). */
export async function buildPublicAttendanceLeaderboard(limit = 100) {
  const canonStart = attendanceCanonStartUtc();
  const sessions = await prisma.squadServerSession.findMany({
    where: {
      joinedAt: { gte: canonStart },
      serverKey: "TPUB1",
    },
    select: {
      userId: true,
      joinedAt: true,
      leftAt: true,
      serverKey: true,
    },
  });

  const byUser = new Map<string, SessionForAttendance[]>();
  for (const s of sessions) {
    if (!byUser.has(s.userId)) byUser.set(s.userId, []);
    byUser.get(s.userId)!.push({
      joinedAt: s.joinedAt,
      leftAt: s.leftAt,
      serverKey: s.serverKey,
    });
  }

  const userIds = [...byUser.keys()];
  const users = await prisma.user.findMany({
    where: { id: { in: userIds }, profileComplete: true },
    select: { id: true, nick: true, avatarUrl: true },
  });
  const nickById = new Map(users.map((u) => [u.id, u]));

  const rows = userIds
    .map((id) => {
      const u = nickById.get(id);
      if (!u?.nick) return null;
      const marks = publicDayMarksFromSessions(byUser.get(id) || []);
      const days = marks.present.size;
      if (days <= 0) return null;
      return {
        nick: u.nick,
        avatarUrl: u.avatarUrl,
        days,
        lateDays: marks.late.size,
      };
    })
    .filter(Boolean) as Array<{
    nick: string;
    avatarUrl: string | null;
    days: number;
    lateDays: number;
  }>;

  rows.sort((a, b) => b.days - a.days || a.nick.localeCompare(b.nick, "ru"));
  return rows.slice(0, limit).map((r, i) => ({ ...r, place: i + 1 }));
}
