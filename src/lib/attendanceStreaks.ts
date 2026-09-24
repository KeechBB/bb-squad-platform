import { prisma } from "@/lib/prisma";
import {
  ATTENDANCE_CANON_START_YMD,
  attendanceCanonStartUtc,
  mskParts,
  presentTrainingDaysFromSessions,
  trainingDayYmd,
  ymdFromMskParts,
} from "@/lib/squadSessions";
import { userInReserve } from "@/lib/reserve";

export type AttendanceStreakRow = {
  userId: string;
  nick: string;
  regNo: number;
  /** Сейчас в резерве */
  inReserve: boolean;
  /** Не пришёл в якорный день тренировки */
  missedToday: boolean;
  /** Подряд дней пропуска, заканчиваясь якорным днём (0 = был) */
  missStreak: number;
  /** Подряд дней явки до якоря включительно (0 = пропуск сегодня) */
  attendStreak: number;
  /** Максимальная серия явки с канона учёта */
  maxAttendStreak: number;
  lastPresent: string | null;
};

export type AttendanceStreakBoard = {
  registered: number;
  anchorYmd: string;
  /** Сколько не пришли в якорный день */
  missedToday: number;
  /** missStreak === n для n=2..7 */
  missByDays: Record<string, number>;
  rows: AttendanceStreakRow[];
  top10: AttendanceStreakRow[];
  updatedAt: string;
};

export function addDaysYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Якорный день для стриков/«сегодня не пришёл».
 * До 21:00 МСК текущего тренировочного дня — берём предыдущий (вечер ещё не начался).
 * С 21:00 — текущий тренировочный день (кто ещё не отметился «был»).
 */
export function attendanceAnchorYmd(now = new Date()): string {
  const td = trainingDayYmd(now);
  const p = mskParts(now);
  const trainToday = trainingDayYmd(now);
  const calToday = ymdFromMskParts(p.y, p.m, p.day);
  let mins = p.h * 60 + p.min;
  if (p.h < 12 && calToday !== trainToday) {
    mins += 24 * 60;
  }
  if (mins < 21 * 60) {
    const prev = addDaysYmd(td, -1);
    return prev < ATTENDANCE_CANON_START_YMD ? ATTENDANCE_CANON_START_YMD : prev;
  }
  return td < ATTENDANCE_CANON_START_YMD ? ATTENDANCE_CANON_START_YMD : td;
}

export function enumerateYmd(fromYmd: string, toYmd: string): string[] {
  if (toYmd < fromYmd) return [];
  const out: string[] = [];
  let cur = fromYmd;
  while (cur <= toYmd) {
    out.push(cur);
    cur = addDaysYmd(cur, 1);
    if (out.length > 400) break;
  }
  return out;
}

export function missStreakEndingAt(
  present: Set<string>,
  anchorYmd: string,
  fromYmd = ATTENDANCE_CANON_START_YMD
): number {
  let streak = 0;
  let d = anchorYmd;
  while (d >= fromYmd) {
    if (present.has(d)) break;
    streak += 1;
    d = addDaysYmd(d, -1);
  }
  return streak;
}

export function attendStreakEndingAt(
  present: Set<string>,
  anchorYmd: string,
  fromYmd = ATTENDANCE_CANON_START_YMD
): number {
  let streak = 0;
  let d = anchorYmd;
  while (d >= fromYmd) {
    if (!present.has(d)) break;
    streak += 1;
    d = addDaysYmd(d, -1);
  }
  return streak;
}

export function maxAttendStreakInRange(
  present: Set<string>,
  fromYmd: string,
  toYmd: string
): number {
  let best = 0;
  let cur = 0;
  for (const d of enumerateYmd(fromYmd, toYmd)) {
    if (present.has(d)) {
      cur += 1;
      if (cur > best) best = cur;
    } else {
      cur = 0;
    }
  }
  return best;
}

export function lastPresentYmd(
  present: Set<string>,
  anchorYmd: string,
  fromYmd = ATTENDANCE_CANON_START_YMD
): string | null {
  let d = anchorYmd;
  while (d >= fromYmd) {
    if (present.has(d)) return d;
    d = addDaysYmd(d, -1);
  }
  return null;
}

export function streakRowFromPresent(
  meta: { userId: string; nick: string; regNo: number; inReserve?: boolean },
  present: Set<string>,
  anchorYmd: string,
  fromYmd = ATTENDANCE_CANON_START_YMD
): AttendanceStreakRow {
  const miss = missStreakEndingAt(present, anchorYmd, fromYmd);
  const attend = attendStreakEndingAt(present, anchorYmd, fromYmd);
  return {
    userId: meta.userId,
    nick: meta.nick,
    regNo: meta.regNo,
    inReserve: Boolean(meta.inReserve),
    missedToday: miss >= 1,
    missStreak: miss,
    attendStreak: attend,
    maxAttendStreak: maxAttendStreakInRange(present, fromYmd, anchorYmd),
    lastPresent: lastPresentYmd(present, anchorYmd, fromYmd),
  };
}

export function summarizeStreakRows(
  rows: AttendanceStreakRow[],
  anchorYmd: string
): AttendanceStreakBoard {
  const missByDays: Record<string, number> = {};
  for (let n = 2; n <= 7; n++) missByDays[String(n)] = 0;
  let missedToday = 0;
  for (const r of rows) {
    if (r.missedToday) missedToday += 1;
    if (r.missStreak >= 2 && r.missStreak <= 7) {
      missByDays[String(r.missStreak)] += 1;
    } else if (r.missStreak > 7) {
      missByDays["7"] += 1;
    }
  }

  const top10 = [...rows]
    .filter((r) => r.attendStreak > 0)
    .sort((a, b) => {
      if (b.attendStreak !== a.attendStreak) return b.attendStreak - a.attendStreak;
      if (b.maxAttendStreak !== a.maxAttendStreak)
        return b.maxAttendStreak - a.maxAttendStreak;
      return a.nick.localeCompare(b.nick, "ru", { sensitivity: "base" });
    })
    .slice(0, 10);

  return {
    registered: rows.length,
    anchorYmd,
    missedToday,
    missByDays,
    rows,
    top10,
    updatedAt: new Date().toISOString(),
  };
}

/** Полный расчёт стриков TR1 с канона учёта — главная и админ-статистика. */
export async function buildAttendanceStreakBoard(
  now = new Date()
): Promise<AttendanceStreakBoard> {
  const anchorYmd = attendanceAnchorYmd(now);
  const fromYmd = ATTENDANCE_CANON_START_YMD;
  if (anchorYmd < fromYmd) {
    return {
      registered: 0,
      anchorYmd: fromYmd,
      missedToday: 0,
      missByDays: Object.fromEntries(
        [2, 3, 4, 5, 6, 7].map((n) => [String(n), 0])
      ),
      rows: [],
      top10: [],
      updatedAt: new Date().toISOString(),
    };
  }

  const users = await prisma.user.findMany({
    where: { profileComplete: true, nick: { not: null } },
    orderBy: [{ regNo: "asc" }, { createdAt: "asc" }],
    select: { id: true, nick: true, regNo: true, reserveUntil: true },
  });

  const sessions = await prisma.squadServerSession.findMany({
    where: {
      serverKey: "TR1",
      joinedAt: { gte: attendanceCanonStartUtc() },
    },
    orderBy: { joinedAt: "asc" },
    select: {
      userId: true,
      joinedAt: true,
      leftAt: true,
      serverKey: true,
    },
  });

  const byUser = new Map<
    string,
    Array<{ joinedAt: Date; leftAt: Date | null; serverKey: string }>
  >();
  for (const s of sessions) {
    if (!byUser.has(s.userId)) byUser.set(s.userId, []);
    byUser.get(s.userId)!.push({
      joinedAt: s.joinedAt,
      leftAt: s.leftAt,
      serverKey: s.serverKey,
    });
  }

  const rows: AttendanceStreakRow[] = users.map((u) => {
    const present = presentTrainingDaysFromSessions(byUser.get(u.id) || [], now);
    return streakRowFromPresent(
      {
        userId: u.id,
        nick: u.nick || "—",
        regNo: u.regNo ?? 0,
        inReserve: userInReserve(u),
      },
      present,
      anchorYmd,
      fromYmd
    );
  });

  return summarizeStreakRows(rows, anchorYmd);
}

export function emptyAttendanceStreakBoard(): AttendanceStreakBoard {
  return {
    registered: 0,
    anchorYmd: ATTENDANCE_CANON_START_YMD,
    missedToday: 0,
    missByDays: Object.fromEntries(
      [2, 3, 4, 5, 6, 7].map((n) => [String(n), 0])
    ),
    rows: [],
    top10: [],
    updatedAt: new Date().toISOString(),
  };
}
