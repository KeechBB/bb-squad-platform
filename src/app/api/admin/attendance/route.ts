import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isAdmin, syncBuiltinAdmins } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import {
  mskParts,
  ATTENDANCE_CANON_START_YMD,
  clampAttendanceFromYmd,
  mergeSessionsWithRejoinGap,
  presentTrainingDaysFromSessions,
  trainingDayYmd,
  trainingWindowOverlapMinutes,
} from "@/lib/squadSessions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function rangeToUtc(fromYmd: string, toYmd: string): { from: Date; to: Date } {
  const [fy, fm, fd] = fromYmd.split("-").map(Number);
  const [ty, tm, td] = toYmd.split("-").map(Number);
  // MSK = UTC+3 → start of from-day MSK = prev day 21:00 UTC
  const from = new Date(Date.UTC(fy, fm - 1, fd, 0, 0, 0) - 3 * 3600 * 1000);
  const to = new Date(Date.UTC(ty, tm - 1, td + 1, 0, 0, 0) - 3 * 3600 * 1000);
  return { from, to };
}

function ymdMsk(d: Date): string {
  const p = mskParts(d);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function hmMsk(d: Date): string {
  const p = mskParts(d);
  return `${String(p.h).padStart(2, "0")}:${String(p.min).padStart(2, "0")}`;
}

/** Выход до 02:00 МСК → день вчерашней тренировки. */
function trainingDayFromLeave(leftAt: Date): string {
  const p = mskParts(leftAt);
  const lmin = p.h * 60 + p.min;
  if (lmin < 2 * 60) {
    const prev = new Date(Date.UTC(p.y, p.m - 1, p.day - 1));
    return `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}-${String(prev.getUTCDate()).padStart(2, "0")}`;
  }
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Выход в окне вечерней тренировки 21:00–02:00 МСК. */
function isEveningLeaveMinutes(lmin: number): boolean {
  return lmin >= 21 * 60 || lmin < 2 * 60;
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session?.user?.steamId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  await syncBuiltinAdmins();
  if (!(await isAdmin(session.user.steamId))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const now = new Date();
  const p = mskParts(now);
  const defaultTo = `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  let fromYmd = clampAttendanceFromYmd(
    url.searchParams.get("from") || ATTENDANCE_CANON_START_YMD
  );
  let toYmd = url.searchParams.get("to") || defaultTo;

  // TR1 = тренировка, PB1/TPUB1 = паблик
  const serverRaw = (url.searchParams.get("server") || "TR1").trim().toUpperCase();
  const serverKey =
    serverRaw === "PB1" || serverRaw === "TPUB1" || serverRaw === "PUB"
      ? "TPUB1"
      : "TR1";

  // clamp inclusive window to ≤ 30 days
  {
    const start = new Date(Date.UTC(
      Number(fromYmd.slice(0, 4)),
      Number(fromYmd.slice(5, 7)) - 1,
      Number(fromYmd.slice(8, 10))
    ));
    const end = new Date(Date.UTC(
      Number(toYmd.slice(0, 4)),
      Number(toYmd.slice(5, 7)) - 1,
      Number(toYmd.slice(8, 10))
    ));
    if (end < start) {
      const t = fromYmd;
      fromYmd = toYmd;
      toYmd = t;
    }
    fromYmd = clampAttendanceFromYmd(fromYmd);
    if (toYmd < fromYmd) toYmd = fromYmd;
    const s2 = new Date(Date.UTC(
      Number(fromYmd.slice(0, 4)),
      Number(fromYmd.slice(5, 7)) - 1,
      Number(fromYmd.slice(8, 10))
    ));
    const e2 = new Date(Date.UTC(
      Number(toYmd.slice(0, 4)),
      Number(toYmd.slice(5, 7)) - 1,
      Number(toYmd.slice(8, 10))
    ));
    const diff = Math.round((e2.getTime() - s2.getTime()) / 86400000) + 1;
    if (diff > 30) {
      s2.setUTCDate(s2.getUTCDate() + 29);
      toYmd = `${s2.getUTCFullYear()}-${String(s2.getUTCMonth() + 1).padStart(2, "0")}-${String(s2.getUTCDate()).padStart(2, "0")}`;
    }
  }

  const { from, to } = rangeToUtc(fromYmd, toYmd);

  const days: string[] = [];
  {
    const cur = new Date(Date.UTC(
      Number(fromYmd.slice(0, 4)),
      Number(fromYmd.slice(5, 7)) - 1,
      Number(fromYmd.slice(8, 10))
    ));
    const end = new Date(Date.UTC(
      Number(toYmd.slice(0, 4)),
      Number(toYmd.slice(5, 7)) - 1,
      Number(toYmd.slice(8, 10))
    ));
    while (cur <= end && days.length < 30) {
      days.push(
        `${cur.getUTCFullYear()}-${String(cur.getUTCMonth() + 1).padStart(2, "0")}-${String(cur.getUTCDate()).padStart(2, "0")}`
      );
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
  }

  const users = await prisma.user.findMany({
    where: { profileComplete: true },
    orderBy: [{ regNo: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      nick: true,
      steamId: true,
      createdAt: true,
      regNo: true,
    },
  });

  const sessions = await prisma.squadServerSession.findMany({
    where: {
      joinedAt: { gte: from, lt: to },
      serverKey,
    },
    orderBy: { joinedAt: "asc" },
    select: {
      userId: true,
      steamId: true,
      joinedAt: true,
      leftAt: true,
      nickAtJoin: true,
      serverKey: true,
    },
  });

  type Cell = { in: string; out: string | null; mins: number };
  const byUserDay = new Map<string, Map<string, Cell[]>>();
  const sessionsByUser = new Map<
    string,
    Array<{ joinedAt: Date; leftAt: Date | null; serverKey: string }>
  >();

  function cellKey(c: Cell): string {
    return `${c.in}|${c.out ?? "…"}`;
  }

  function pushCell(userId: string, day: string, cell: Cell) {
    if (!byUserDay.has(userId)) byUserDay.set(userId, new Map());
    const m = byUserDay.get(userId)!;
    if (!m.has(day)) m.set(day, []);
    const list = m.get(day)!;
    // не показывать Login/PostLogin-близнецов с тем же in/out
    if (list.some((x) => cellKey(x) === cellKey(cell))) return;
    // почти тот же заход (±1 мин) с тем же выходом — оставить один
    const inM = Number(cell.in.slice(0, 2)) * 60 + Number(cell.in.slice(3, 5));
    const near = list.findIndex((x) => {
      const xm = Number(x.in.slice(0, 2)) * 60 + Number(x.in.slice(3, 5));
      return Math.abs(xm - inM) <= 1 && (x.out ?? "") === (cell.out ?? "");
    });
    if (near >= 0) {
      if (cell.mins >= list[near].mins) list[near] = cell;
      return;
    }
    list.push(cell);
  }

  for (const s of sessions) {
    if (!sessionsByUser.has(s.userId)) sessionsByUser.set(s.userId, []);
    sessionsByUser.get(s.userId)!.push({
      joinedAt: s.joinedAt,
      leftAt: s.leftAt,
      serverKey: s.serverKey,
    });

    // TR1: колонка = день тренировки; PB1: календарный день захода
    const day = serverKey === "TR1" ? trainingDayYmd(s.joinedAt) : ymdMsk(s.joinedAt);
    if (!days.includes(day)) continue;
    const end = s.leftAt ?? now;
    const mins = Math.max(
      0,
      Math.round((end.getTime() - s.joinedAt.getTime()) / 60000)
    );
    pushCell(s.userId, day, {
      in: hmMsk(s.joinedAt),
      out: s.leftAt ? hmMsk(s.leftAt) : null,
      mins,
    });
  }

  const daySet = new Set(days);
  const rows = users.map((u) => {
    const dayMap = byUserDay.get(u.id) || new Map();
    const cells: Record<string, Cell[]> = {};
    for (const d of days) cells[d] = dayMap.get(d) || [];
    const presentDays = [...presentTrainingDaysFromSessions(sessionsByUser.get(u.id) || [], now)]
      .filter((d) => daySet.has(d))
      .sort();
    return {
      regNo: u.regNo ?? 0,
      userId: u.id,
      nick: u.nick,
      steamId: u.steamId,
      cells,
      presentDays,
    };
  });

  // stats
  let totalSessions = 0;
  let totalMinutes = 0;
  const leaveBucket: Record<string, number> = {
    "21": 0,
    "22": 0,
    "23": 0,
    "00": 0,
    "01": 0,
    other: 0,
  };
  const joinBucket: Record<string, number> = {
    before21: 0,
    "2130": 0,
    after2130: 0,
  };
  const weekday = [0, 0, 0, 0, 0, 0, 0];
  const isPublic = serverKey === "TPUB1";

  /** Уникальные в окне 21:00–00:00 (для средних) */
  const uniqueMidnightByDay: Record<string, Set<string>> = {};
  /** Уникальные в окне 21:00–02:00 (для календаря; до 02:00 = вчерашняя тренировка) */
  const uniqueUntil02ByDay: Record<string, Set<string>> = {};
  /** Первое вечернее касание окна 21–02: user|day → join minutes MSK */
  const firstEveningJoinMin = new Map<string, number>();

  type Slot = { label: string; minFrom: number; minTo: number };
  const leaveSlots: Slot[] = [
    { label: "21:00", minFrom: 21 * 60, minTo: 21 * 60 + 30 },
    { label: "21:30", minFrom: 21 * 60 + 30, minTo: 22 * 60 },
    { label: "22:00", minFrom: 22 * 60, minTo: 22 * 60 + 30 },
    { label: "22:30", minFrom: 22 * 60 + 30, minTo: 23 * 60 },
    { label: "23:00", minFrom: 23 * 60, minTo: 23 * 60 + 30 },
    { label: "23:30", minFrom: 23 * 60 + 30, minTo: 24 * 60 },
    { label: "00:00", minFrom: 0, minTo: 30 },
    { label: "00:30", minFrom: 30, minTo: 60 },
    { label: "01:00", minFrom: 60, minTo: 90 },
    { label: "01:30", minFrom: 90, minTo: 120 },
  ];
  const leaveSlotUsers: Array<Set<string>> = leaveSlots.map(() => new Set());
  /** Ники финальных уходов (все слоты вечера) */
  const leaveSlotNicks: Array<Map<string, string>> = leaveSlots.map(
    () => new Map()
  );
  /** То же по дням тренировки — для фильтра «один день» */
  const leaveSlotUsersByDay = new Map<string, Array<Set<string>>>();
  const leaveSlotNicksByDay = new Map<string, Array<Map<string, string>>>();

  function ensureLeaveDay(day: string) {
    if (!leaveSlotUsersByDay.has(day)) {
      leaveSlotUsersByDay.set(
        day,
        leaveSlots.map(() => new Set())
      );
      leaveSlotNicksByDay.set(
        day,
        leaveSlots.map(() => new Map())
      );
    }
  }

  const joinSlots: Slot[] = [
    { label: "≤20:00", minFrom: 0, minTo: 20 * 60 },
    { label: "20:00", minFrom: 20 * 60, minTo: 20 * 60 + 30 },
    { label: "20:30", minFrom: 20 * 60 + 30, minTo: 21 * 60 },
    { label: "21:00", minFrom: 21 * 60, minTo: 21 * 60 + 30 },
    { label: "21:30", minFrom: 21 * 60 + 30, minTo: 22 * 60 },
    { label: "22:00", minFrom: 22 * 60, minTo: 22 * 60 + 30 },
    { label: "22:30+", minFrom: 22 * 60 + 30, minTo: 24 * 60 },
  ];
  const joinSlotUsers: Array<Set<string>> = joinSlots.map(() => new Set());

  /** Сессии по user → для финального выхода (ушёл и больше не заходил) */
  const sessionsByUserChrono = new Map<
    string,
    Array<{ joinedAt: Date; leftAt: Date | null; nick: string | null }>
  >();
  const nickByUserId = new Map(
    users.map((u) => [u.id, (u.nick || "").trim() || u.steamId])
  );

  for (const s of sessions) {
    totalSessions += 1;
    const end = s.leftAt ?? now;
    totalMinutes += Math.max(
      0,
      Math.round((end.getTime() - s.joinedAt.getTime()) / 60000)
    );
    const jp = mskParts(s.joinedAt);
    const jmin = jp.h * 60 + jp.min;
    if (jmin <= 21 * 60) joinBucket.before21 += 1;
    else if (jmin <= 21 * 60 + 30) joinBucket["2130"] += 1;
    else joinBucket.after2130 += 1;

    if (s.leftAt) {
      const lp = mskParts(s.leftAt);
      const key =
        lp.h === 21
          ? "21"
          : lp.h === 22
            ? "22"
            : lp.h === 23
              ? "23"
              : lp.h === 0
                ? "00"
                : lp.h === 1
                  ? "01"
                  : "other";
      leaveBucket[key] = (leaveBucket[key] || 0) + 1;
    }

    if (!sessionsByUserChrono.has(s.userId)) {
      sessionsByUserChrono.set(s.userId, []);
    }
    sessionsByUserChrono.get(s.userId)!.push({
      joinedAt: s.joinedAt,
      leftAt: s.leftAt,
      nick: s.nickAtJoin,
    });

    const day = isPublic ? ymdMsk(s.joinedAt) : trainingDayYmd(s.joinedAt);

    if (isPublic) {
      if (!uniqueMidnightByDay[day]) uniqueMidnightByDay[day] = new Set();
      uniqueMidnightByDay[day].add(s.userId);
      if (!uniqueUntil02ByDay[day]) uniqueUntil02ByDay[day] = new Set();
      uniqueUntil02ByDay[day].add(s.userId);
    } else {
      if (trainingWindowOverlapMinutes(s.joinedAt, s.leftAt, 24, now) > 0) {
        if (!uniqueMidnightByDay[day]) uniqueMidnightByDay[day] = new Set();
        uniqueMidnightByDay[day].add(s.userId);
      }
      if (trainingWindowOverlapMinutes(s.joinedAt, s.leftAt, 26, now) > 0) {
        if (!uniqueUntil02ByDay[day]) uniqueUntil02ByDay[day] = new Set();
        uniqueUntil02ByDay[day].add(s.userId);

        const fk = `${s.userId}|${day}`;
        const prev = firstEveningJoinMin.get(fk);
        if (prev == null || jmin < prev) {
          firstEveningJoinMin.set(fk, jmin);
        }
      }
    }

    const wi = (() => {
      const utcish = Date.UTC(jp.y, jp.m - 1, jp.day);
      const dow = new Date(utcish).getUTCDay();
      return dow === 0 ? 6 : dow - 1;
    })();
    weekday[wi] += 1;
  }

  // Финальный выход за тренировочный вечер: ушёл и не вернулся за 5 минут
  if (!isPublic) {
    for (const [userId, list] of sessionsByUserChrono) {
      const byTrainDay = new Map<string, typeof list>();
      for (const s of list) {
        const d = trainingDayYmd(s.joinedAt);
        if (!byTrainDay.has(d)) byTrainDay.set(d, []);
        byTrainDay.get(d)!.push(s);
      }
      for (const [trainDay, daySessions] of byTrainDay) {
        if (!daySet.has(trainDay)) continue;
        const spans = mergeSessionsWithRejoinGap(daySessions);
        const last = spans[spans.length - 1];
        if (!last?.leave) continue;
        const lp = mskParts(last.leave);
        const lmin = lp.h * 60 + lp.min;
        if (!isEveningLeaveMinutes(lmin)) continue;
        const leaveDay = trainingDayFromLeave(last.leave);
        if (leaveDay !== trainDay) continue;
        const key = `${userId}|${trainDay}`;
        const displayNick =
          nickByUserId.get(userId) ||
          (daySessions[daySessions.length - 1]?.nick || "").trim() ||
          userId;
        for (let i = 0; i < leaveSlots.length; i++) {
          const sl = leaveSlots[i];
          if (lmin >= sl.minFrom && lmin < sl.minTo) {
            leaveSlotUsers[i].add(key);
            leaveSlotNicks[i].set(key, displayNick);
            ensureLeaveDay(trainDay);
            leaveSlotUsersByDay.get(trainDay)![i].add(key);
            leaveSlotNicksByDay.get(trainDay)![i].set(key, displayNick);
            break;
          }
        }
      }
    }
  }

  // Пересчитать first-join слоты по уникальному первому заходу вечера
  if (!isPublic) {
    for (let i = 0; i < joinSlotUsers.length; i++) joinSlotUsers[i].clear();
    for (const [fk, jmin] of firstEveningJoinMin) {
      for (let i = 0; i < joinSlots.length; i++) {
        const sl = joinSlots[i];
        if (jmin >= sl.minFrom && jmin < sl.minTo) {
          joinSlotUsers[i].add(fk);
          break;
        }
      }
    }
  }

  const dayPlayerCounts = days.map((d) => ({
    day: d,
    players: uniqueMidnightByDay[d]?.size || 0,
  }));
  const calendarUnique = days.map((d) => ({
    day: d,
    players: uniqueUntil02ByDay[d]?.size || 0,
  }));

  const avgPlayers =
    dayPlayerCounts.length > 0
      ? Math.round(
          (10 *
            dayPlayerCounts.reduce((s, x) => s + x.players, 0)) /
            dayPlayerCounts.length
        ) / 10
      : 0;

  // week / month averages from 21:00–00:00 daily uniques
  const byWeek = new Map<string, number[]>();
  const byMonth = new Map<string, number[]>();
  for (const { day, players } of dayPlayerCounts) {
    const [y, m, d] = day.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    const dow = dt.getUTCDay(); // 0 Sun
    const mondayOffset = dow === 0 ? -6 : 1 - dow;
    const monday = new Date(dt);
    monday.setUTCDate(dt.getUTCDate() + mondayOffset);
    const weekKey = monday.toISOString().slice(0, 10);
    const monthKey = `${y}-${String(m).padStart(2, "0")}`;
    if (!byWeek.has(weekKey)) byWeek.set(weekKey, []);
    byWeek.get(weekKey)!.push(players);
    if (!byMonth.has(monthKey)) byMonth.set(monthKey, []);
    byMonth.get(monthKey)!.push(players);
  }
  const weekSums = [...byWeek.values()].map((arr) =>
    arr.reduce((a, b) => a + b, 0)
  );
  const monthSums = [...byMonth.values()].map((arr) =>
    arr.reduce((a, b) => a + b, 0)
  );
  const avgPlayersPerWeek =
    weekSums.length > 0
      ? Math.round((10 * weekSums.reduce((a, b) => a + b, 0)) / weekSums.length) /
        10
      : 0;
  const avgPlayersPerMonth =
    monthSums.length > 0
      ? Math.round(
          (10 * monthSums.reduce((a, b) => a + b, 0)) / monthSums.length
        ) / 10
      : 0;

  let leaveCum = 0;
  const leaveTimeline = leaveSlots.map((sl, i) => {
    const count = leaveSlotUsers[i].size;
    leaveCum += count;
    const nicks = [...leaveSlotNicks[i].values()].sort((a, b) =>
      a.localeCompare(b, "ru", { sensitivity: "base" })
    );
    return {
      label: sl.label,
      count,
      cumulative: leaveCum,
      nicks: nicks.length ? nicks : undefined,
    };
  });

  const leaveByDay: Record<
    string,
    Array<{ label: string; count: number; nicks?: string[] }>
  > = {};
  for (const d of days) {
    const usersSets = leaveSlotUsersByDay.get(d);
    const nickMaps = leaveSlotNicksByDay.get(d);
    leaveByDay[d] = leaveSlots.map((sl, i) => {
      const count = usersSets?.[i]?.size || 0;
      const nicks = nickMaps?.[i]
        ? [...nickMaps[i].values()].sort((a, b) =>
            a.localeCompare(b, "ru", { sensitivity: "base" })
          )
        : [];
      return {
        label: sl.label,
        count,
        nicks: nicks.length ? nicks : undefined,
      };
    });
  }

  let joinCum = 0;
  const joinTimeline = joinSlots.map((sl, i) => {
    const count = joinSlotUsers[i].size;
    joinCum += count;
    return { label: sl.label, count, cumulative: joinCum };
  });

  let onTime = 0;
  let lateOk = 0;
  let late = 0;
  for (const jmin of firstEveningJoinMin.values()) {
    if (jmin <= 21 * 60) onTime += 1;
    else if (jmin <= 21 * 60 + 30) lateOk += 1;
    else late += 1;
  }

  const windowLabel = isPublic
    ? "00:00–24:00 МСК"
    : `21:00–00:00 МСК (средние) · календарь 21:00–02:00`;

  return NextResponse.json({
    from: fromYmd,
    to: toYmd,
    server: isPublic ? "PB1" : "TR1",
    days,
    rows,
    stats: {
      totalSessions,
      totalMinutes,
      avgSessionMin:
        totalSessions > 0 ? Math.round(totalMinutes / totalSessions) : 0,
      uniquePlayers: new Set(sessions.map((s) => s.userId)).size,
      leaveBucket,
      joinBucket,
      weekday,
      dayPlayerCounts,
      calendarUnique,
      avgPlayersPerDay: avgPlayers,
      avgPlayersPerWeek,
      avgPlayersPerMonth,
      leaveTimeline,
      leaveByDay,
      joinTimeline,
      joinNorm: { onTime, lateOk, late, total: onTime + lateOk + late },
      windowLabel,
      windowMode: isPublic ? "day" : "evening",
    },
  });
}
