/**
 * Ежедневный ивент дня (паблик «Фруктовый сад»).
 * Окно: текущие сутки МСК до 23:59. Награды — нашивки навсегда.
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

export type EventDayProgress = {
  /** YYYY-MM-DD МСК */
  day: string;
  /** «14.11.2026» */
  dayLabel: string;
  /** До 23:59 МСК этого дня */
  untilLabel: string;
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

export function eventDayUntilLabel(ymd = mskYmd()): string {
  return `до 23:59 МСК ${mskDayLabel(ymd)}`;
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

  const agg = await prisma.profileMatchLine.aggregate({
    where: { kind: "public", nickKey: key, playedOn: day },
    _sum: { kills: true, res: true },
  });
  return {
    day,
    kills: Math.max(0, Math.round(Number(agg._sum.kills) || 0)),
    res: Math.max(0, Math.round(Number(agg._sum.res) || 0)),
  };
}

export async function buildEventDayProgress(opts: {
  nick: string | null | undefined;
  unlockedNickPatches?: readonly string[];
}): Promise<EventDayProgress> {
  const day = mskYmd();
  const unlocks = new Set(opts.unlockedNickPatches || []);
  const stats = opts.nick
    ? await loadEventDayPublicStats(opts.nick)
    : { day, kills: 0, res: 0 };
  const kills = stats.kills;
  const res = stats.res;
  return {
    day,
    dayLabel: mskDayLabel(day),
    untilLabel: eventDayUntilLabel(day),
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
      body: `Нашивка за ${EVENT_DAY_KILLS_GOAL} киллов за день на паблике. Ставится у ника в кастомизации.`,
      imageUrl: profilePatchUrl(id),
    };
  }
  if (id === EVENT_DAY_SCAR_PATCH_ID) {
    return {
      title: "SCAR «Лимонный шквал»",
      body: `Нашивка за ${EVENT_DAY_RES_GOAL} ресов за день на паблике. Ставится у ника в кастомизации.`,
      imageUrl: profilePatchUrl(id),
    };
  }
  return null;
}
