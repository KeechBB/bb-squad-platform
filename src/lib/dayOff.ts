import { prisma } from "@/lib/prisma";
import { personLabel, writeActionLog } from "@/lib/actionLog";
import { livePublish, userLiveChannel } from "@/lib/liveBus";
import { formatRuDate, isActiveReserve } from "@/lib/validation";
import { formatMskYmd } from "@/lib/squadHits";
import { ATTENDANCE_CANON_START_YMD } from "@/lib/squadSessions";
import {
  DAY_OFF_MAX_DAYS,
  DAY_OFF_MIN_DAYS,
  inclusiveCalendarDays,
  todayUtcMidnight,
} from "@/lib/absenceDays";
import type { ReserveActor } from "@/lib/reserve";
import { exitReserve, userInReserve } from "@/lib/reserve";

function addDaysYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Дни МСК выходного на календарь.
 * Открытый stint — до untilAt (в т.ч. будущие).
 * Закрытый — до min(exitedAt, untilAt): если вышли поздно (после срока),
 * лишние дни после untilAt не красим как выходной.
 */
export function dayOffTrainingDaysFromStints(
  stints: Array<{
    enteredAt: Date;
    untilAt: Date;
    exitedAt: Date | null;
  }>
): string[] {
  const days = new Set<string>();
  for (const s of stints) {
    let start = formatMskYmd(s.enteredAt);
    const untilYmd = formatMskYmd(s.untilAt);
    let end = untilYmd;
    if (s.exitedAt) {
      const exitedYmd = formatMskYmd(s.exitedAt);
      end = exitedYmd < untilYmd ? exitedYmd : untilYmd;
    }
    if (start < ATTENDANCE_CANON_START_YMD) {
      start = ATTENDANCE_CANON_START_YMD;
    }
    if (start > end) continue;
    let d = start;
    while (d <= end) {
      days.add(d);
      d = addDaysYmd(d, 1);
      if (days.size > 800) break;
    }
  }
  return [...days].sort();
}

/** При закрытии stint не уезжать exitedAt за untilAt. */
export function clampDayOffExitAt(untilAt: Date, when: Date = new Date()): Date {
  return when.getTime() <= untilAt.getTime() ? when : untilAt;
}

export async function dayOffDaysForUser(userId: string): Promise<string[]> {
  const stints = await prisma.dayOffStint.findMany({
    where: { userId },
    select: { enteredAt: true, untilAt: true, exitedAt: true },
    orderBy: { enteredAt: "asc" },
  });
  return dayOffTrainingDaysFromStints(stints);
}

export function userOnDayOff(u: {
  dayOffUntil: Date | null;
}): boolean {
  return isActiveReserve(u.dayOffUntil);
}

export async function enterDayOff(opts: {
  userId: string;
  until: Date;
  reason: string;
  source: "self" | "admin";
  actor: ReserveActor;
  /** Админ может задать дату начала (в т.ч. задним числом). */
  enteredAt?: Date;
}) {
  const me = await prisma.user.findUnique({
    where: { id: opts.userId },
    select: {
      id: true,
      nick: true,
      name: true,
      steamName: true,
      steamId: true,
      reserveUntil: true,
      dayOffUntil: true,
    },
  });
  if (!me) throw new Error("user_not_found");

  const enteredAt = opts.enteredAt ?? todayUtcMidnight();
  const days = inclusiveCalendarDays(enteredAt, opts.until);
  if (opts.source === "self") {
    if (days < DAY_OFF_MIN_DAYS || days > DAY_OFF_MAX_DAYS) {
      throw new Error("day_off_range");
    }
  } else if (days < 1) {
    throw new Error("day_off_range");
  }

  // Взаимоисключение с резервом
  if (userInReserve(me)) {
    await exitReserve({
      userId: me.id,
      source: opts.source,
      actor: opts.actor,
    });
  }

  const openPrev = await prisma.dayOffStint.findMany({
    where: { userId: me.id, exitedAt: null },
    select: { id: true, untilAt: true },
  });
  const now = new Date();
  for (const prev of openPrev) {
    await prisma.dayOffStint.update({
      where: { id: prev.id },
      data: {
        exitedAt: clampDayOffExitAt(prev.untilAt, now),
        exitedById: opts.actor.id,
      },
    });
  }

  const user = await prisma.user.update({
    where: { id: me.id },
    data: { dayOffUntil: opts.until, dayOffReason: opts.reason },
    select: {
      id: true,
      nick: true,
      name: true,
      steamName: true,
      steamId: true,
      dayOffUntil: true,
      dayOffReason: true,
    },
  });

  const today = todayUtcMidnight();
  const pastOnly =
    opts.source === "admin" && opts.until.getTime() < today.getTime();

  const stint = await prisma.dayOffStint.create({
    data: {
      userId: me.id,
      enteredAt,
      untilAt: opts.until,
      reason: opts.reason,
      source: opts.source,
      enteredById: opts.actor.id,
      ...(pastOnly
        ? { exitedAt: opts.until, exitedById: opts.actor.id }
        : {}),
    },
  });

  // Задним числом: только история на календаре, без активного статуса
  if (pastOnly) {
    await prisma.user.update({
      where: { id: me.id },
      data: { dayOffUntil: null, dayOffReason: null },
    });
    user.dayOffUntil = null;
    user.dayOffReason = null;
  }

  livePublish(userLiveChannel(me.id), JSON.stringify({ type: "day-off" }));

  const target = personLabel(user);
  const actor = personLabel(opts.actor);
  const untilLabel = formatRuDate(opts.until);
  const msg =
    opts.source === "admin"
      ? `${actor} выдал выходной ${target} до ${untilLabel} (причина: ${opts.reason})`
      : `${target} взял выходной до ${untilLabel} (причина: ${opts.reason})`;

  await writeActionLog({
    category: opts.source === "admin" ? "admin" : "profile",
    action: "day_off_enter",
    message: msg,
    actorId: opts.actor.id,
    actorNick: actor,
    targetId: me.id,
    targetNick: target,
    meta: {
      until: opts.until.toISOString(),
      enteredAt: enteredAt.toISOString(),
      reason: opts.reason,
      source: opts.source,
      stintId: stint.id,
      days,
    },
  });

  return { user, stint };
}

export async function exitDayOff(opts: {
  userId: string;
  source: "self" | "admin";
  actor: ReserveActor;
}) {
  const me = await prisma.user.findUnique({
    where: { id: opts.userId },
    select: {
      id: true,
      nick: true,
      name: true,
      steamName: true,
      steamId: true,
    },
  });
  if (!me) throw new Error("user_not_found");

  const user = await prisma.user.update({
    where: { id: me.id },
    data: { dayOffUntil: null, dayOffReason: null },
    select: {
      id: true,
      nick: true,
      name: true,
      steamName: true,
      steamId: true,
      dayOffUntil: true,
      dayOffReason: true,
    },
  });

  const open = await prisma.dayOffStint.findMany({
    where: { userId: me.id, exitedAt: null },
    select: { id: true, untilAt: true },
  });
  const nowExit = new Date();
  for (const s of open) {
    await prisma.dayOffStint.update({
      where: { id: s.id },
      data: {
        exitedAt: clampDayOffExitAt(s.untilAt, nowExit),
        exitedById: opts.actor.id,
      },
    });
  }

  livePublish(userLiveChannel(me.id), JSON.stringify({ type: "day-off" }));

  const target = personLabel(user);
  const actor = personLabel(opts.actor);
  const msg =
    opts.source === "admin"
      ? `${actor} снял выходной у ${target}`
      : `${target} вышел с выходного`;

  await writeActionLog({
    category: opts.source === "admin" ? "admin" : "profile",
    action: "day_off_exit",
    message: msg,
    actorId: opts.actor.id,
    actorNick: actor,
    targetId: me.id,
    targetNick: target,
    meta: { source: opts.source },
  });

  return { user };
}

export async function correctDayOffEnteredAt(opts: {
  stintId: string;
  enteredAt: Date;
  actor: ReserveActor;
}) {
  const stint = await prisma.dayOffStint.findUnique({
    where: { id: opts.stintId },
    include: {
      user: {
        select: {
          id: true,
          nick: true,
          name: true,
          steamName: true,
          steamId: true,
        },
      },
    },
  });
  if (!stint) throw new Error("stint_not_found");

  const endCap = stint.exitedAt ?? new Date();
  if (opts.enteredAt.getTime() > endCap.getTime()) {
    throw new Error("entered_after_exit");
  }
  if (opts.enteredAt.getTime() > stint.untilAt.getTime()) {
    throw new Error("entered_after_until");
  }

  const prev = stint.enteredAt;
  const updated = await prisma.dayOffStint.update({
    where: { id: stint.id },
    data: { enteredAt: opts.enteredAt },
  });

  const target = personLabel(stint.user);
  const actor = personLabel(opts.actor);
  await writeActionLog({
    category: "admin",
    action: "day_off_entered_at_fix",
    message: `${actor} поправил дату начала выходного у ${target}: ${formatRuDate(prev)} → ${formatRuDate(opts.enteredAt)}`,
    actorId: opts.actor.id,
    actorNick: actor,
    targetId: stint.user.id,
    targetNick: target,
    meta: {
      stintId: stint.id,
      from: prev.toISOString(),
      to: opts.enteredAt.toISOString(),
    },
  });

  return { stint: updated };
}
