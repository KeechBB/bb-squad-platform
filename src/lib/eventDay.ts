/**
 * Ежедневный ивент дня (паблик «Фруктовый сад»).
 * Окно показа и подсчёта: 15:45–23:59 МСК. В 00:00 блок с главной скрыт.
 * Награды — нашивки навсегда.
 */
import { prisma } from "@/lib/prisma";
import { profileHistoryKey } from "@/lib/nickCollisions";
import {
  profilePatchUrl,
  type ProfilePatchId,
} from "@/lib/profilePatches";

export const EVENT_DAY_SAIGA_PATCH_ID =
  "creator-event-saiga-apple" as const satisfies ProfilePatchId;
export const EVENT_DAY_SCAR_PATCH_ID =
  "creator-event-scar-lemon" as const satisfies ProfilePatchId;

export const EVENT_DAY_KILLS_GOAL = 100;
export const EVENT_DAY_RES_GOAL = 50;

/** Минуты от полуночи МСК: старт подсчёта / показа */
export const EVENT_DAY_START_MIN = 15 * 60 + 45; // 15:45
/** Минуты от полуночи МСК: конец окна (включительно) */
export const EVENT_DAY_END_MIN = 23 * 60 + 59; // 23:59

export type EventDayProgress = {
  /** YYYY-MM-DD МСК */
  day: string;
  /** «14.11.2026» */
  dayLabel: string;
  /** «с 15:45 до 23:59 МСК 14.11.2026» */
  untilLabel: string;
  /** Сейчас 15:45–23:59 МСК — блок на главной виден */
  live: boolean;
  kills: number;
  res: number;
  saigaDone: boolean;
  scarDone: boolean;
  saigaUnlocked: boolean;
  scarUnlocked: boolean;
};

export function mskYmd(d = new Date()): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Europe/Moscow" });
}

export function mskDayLabel(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

export function mskMinutesNow(d = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === "hour")?.value || 0);
  const mi = Number(parts.find((p) => p.type === "minute")?.value || 0);
  return h * 60 + mi;
}

/** Блок на главной только в окне 15:45–23:59 МСК. */
export function isEventDayLive(d = new Date()): boolean {
  const min = mskMinutesNow(d);
  return min >= EVENT_DAY_START_MIN && min <= EVENT_DAY_END_MIN;
}

export function eventDayUntilLabel(ymd = mskYmd()): string {
  return `с 15:45 до 23:59 МСК ${mskDayLabel(ymd)}`;
}

function timeLabelMinutes(label: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(label || "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mi)) return null;
  return h * 60 + mi;
}

/** Катка попала в окно ивента (15:45–23:59 МСК). */
export function isEventDayMatchTime(timeLabel: string): boolean {
  const min = timeLabelMinutes(timeLabel);
  if (min == null) return false;
  return min >= EVENT_DAY_START_MIN && min <= EVENT_DAY_END_MIN;
}

export async function loadEventDayPublicStats(nick: string): Promise<{
  day: string;
  kills: number;
  res: number;
}> {
  const day = mskYmd();
  const clean = String(nick || "").trim();
  if (!clean) return { day, kills: 0, res: 0 };
  const key = profileHistoryKey(clean);
  if (!key) return { day, kills: 0, res: 0 };

  const rows = await prisma.profileMatchLine.findMany({
    where: { kind: "public", nickKey: key, playedOn: day },
    select: { kills: true, res: true, timeLabel: true },
  });

  let kills = 0;
  let res = 0;
  for (const row of rows) {
    if (!isEventDayMatchTime(row.timeLabel)) continue;
    kills += Math.max(0, Math.round(Number(row.kills) || 0));
    res += Math.max(0, Math.round(Number(row.res) || 0));
  }
  return { day, kills, res };
}

export async function buildEventDayProgress(opts: {
  nick: string | null | undefined;
  unlockedNickPatches?: readonly string[];
  now?: Date;
}): Promise<EventDayProgress> {
  const now = opts.now || new Date();
  const day = mskYmd(now);
  const live = isEventDayLive(now);
  const unlocks = new Set(opts.unlockedNickPatches || []);
  const stats =
    live && opts.nick
      ? await loadEventDayPublicStats(opts.nick)
      : { day, kills: 0, res: 0 };
  const kills = stats.kills;
  const res = stats.res;
  return {
    day,
    dayLabel: mskDayLabel(day),
    untilLabel: eventDayUntilLabel(day),
    live,
    kills,
    res,
    saigaDone: kills >= EVENT_DAY_KILLS_GOAL,
    scarDone: res >= EVENT_DAY_RES_GOAL,
    saigaUnlocked: unlocks.has(EVENT_DAY_SAIGA_PATCH_ID),
    scarUnlocked: unlocks.has(EVENT_DAY_SCAR_PATCH_ID),
  };
}

export function eventDayRewardMeta(id: ProfilePatchId): {
  title: string;
  body: string;
  imageUrl: string | null;
} | null {
  if (id === EVENT_DAY_SAIGA_PATCH_ID) {
    return {
      title: "Сайга «Яблочный разброс»",
      body: `Нашивка за ${EVENT_DAY_KILLS_GOAL} киллов в окне ивента дня (15:45–23:59 МСК) на паблике.`,
      imageUrl: profilePatchUrl(id),
    };
  }
  if (id === EVENT_DAY_SCAR_PATCH_ID) {
    return {
      title: "SCAR «Лимонный шквал»",
      body: `Нашивка за ${EVENT_DAY_RES_GOAL} ресов в окне ивента дня (15:45–23:59 МСК) на паблике.`,
      imageUrl: profilePatchUrl(id),
    };
  }
  return null;
}
