/** Канон гонки фракций / принуд. штрафа. Легион вне системы. */

/** 21.11.2026 00:00 МСК — старт эпохи недельных окон. */
export const RACE_EPOCH_START = new Date("2026-11-20T21:00:00.000Z");
export const RACE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Хвост после календарных 00:00: до конца ночной TR (21:00–01:00 МСК). */
export const RACE_TRAIN_TAIL_MS = 60 * 60 * 1000;
export const RACE_GRACE_MS = 24 * 60 * 60 * 1000;
/** База после ×2 гринда (с окна после 2026-11-21). */
export const RACE_BASE_GOAL = 800_000;
/**
 * После этого окна всем фракциям выставляется RACE_BASE_GOAL (800k),
 * дальше снова ×1.05 / ×0.95 от личной цели.
 */
export const RACE_GOAL_RESET_AFTER_WINDOW = "2026-11-21";
export const RACE_GOAL_UP = 1.05;
export const RACE_GOAL_DOWN = 0.95;

export const RACE_FACTION_NAMES = ["Орда", "Улей", "Сброд", "Стая", "Табор"] as const;

/**
 * Что идёт в прогресс гонки: гринд плюс ночные ставки.
 * Ставка (night_bet, −) вычитается из гонки; выигрыш/возврат (night_bet_win / refund, +) добавляется.
 * Легион вне гонки — его проводки сюда не попадают через listRacingFactions.
 */
export const RACE_PROGRESS_BET_KINDS = [
  "night_bet",
  "night_bet_win",
  "night_bet_refund",
] as const;

/** Фильтр ledger для суммы прогресса гонки за окно. */
export function raceProgressLedgerWhere(
  factionId: string | { in: string[] },
  start: Date,
  end: Date
) {
  return {
    factionId,
    createdAt: { gte: start, lt: end },
    OR: [
      { kind: "grind", amount: { gt: 0 } },
      { kind: { in: [...RACE_PROGRESS_BET_KINDS] } },
    ],
  };
}

export function isRaceExcludedName(...parts: (string | null | undefined)[]): boolean {
  const key = parts
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[\s_-]+/g, "");
  return key.includes("легион");
}

export function isRaceFactionName(name: string): boolean {
  return (RACE_FACTION_NAMES as readonly string[]).includes(name);
}

export type RaceWindowBounds = {
  id: string;
  index: number;
  start: Date;
  end: Date;
};

function pad2(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

/** YMD по Москве для даты. */
export function raceMskYmd(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value || "1970";
  const m = parts.find((p) => p.type === "month")?.value || "01";
  const day = parts.find((p) => p.type === "day")?.value || "01";
  return `${y}-${m}-${day}`;
}

function mskHourMinute(d: Date): { h: number; m: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  return {
    h: Number(parts.find((p) => p.type === "hour")?.value || "0"),
    m: Number(parts.find((p) => p.type === "minute")?.value || "0"),
  };
}

/**
 * Недельное окно прогресса: календарные 7×24ч + хвост до 01:00 МСК
 * (последняя ночная тренировка 7-го дня). Со следующего индекса старт
 * прогресса сдвигается на +1ч, чтобы хвост прошлой недели не двоился.
 */
export function raceWindowByIndex(index: number): RaceWindowBounds {
  const calendarStart = new Date(RACE_EPOCH_START.getTime() + index * RACE_WINDOW_MS);
  const calendarEnd = new Date(calendarStart.getTime() + RACE_WINDOW_MS);
  const start =
    index === 0
      ? calendarStart
      : new Date(calendarStart.getTime() + RACE_TRAIN_TAIL_MS);
  const end = new Date(calendarEnd.getTime() + RACE_TRAIN_TAIL_MS);
  return { id: raceMskYmd(calendarStart), index, start, end };
}

export function raceWindowAt(at: Date = new Date()): RaceWindowBounds | null {
  const ms = at.getTime() - RACE_EPOCH_START.getTime();
  if (ms < 0) return null;
  const index = Math.floor(ms / RACE_WINDOW_MS);
  // 00:00–01:00 после календарной границы — ещё прошлое окно (хвост TR).
  if (index > 0) {
    const prev = raceWindowByIndex(index - 1);
    if (at < prev.end) return prev;
  }
  return raceWindowByIndex(index);
}

/**
 * День последней тренировки окна гонки (YMD МСК) =
 * календарный день перед субботним 00:00 закрытия (пт. вечер → сб. 01:00).
 */
export function lastRaceTrainingDayYmd(bounds: RaceWindowBounds): string {
  const calendarEnd = new Date(bounds.end.getTime() - RACE_TRAIN_TAIL_MS);
  const prev = new Date(calendarEnd.getTime() - 24 * 60 * 60 * 1000);
  return raceMskYmd(prev);
}

/** Подпись: «21.11 00:00 — 28.11 01:00 МСК» (конец = после последней TR). */
export function formatRaceWindowLabel(start: Date, end: Date): string {
  const fmt = (d: Date) => {
    const p = new Intl.DateTimeFormat("ru-RU", {
      timeZone: "Europe/Moscow",
      day: "2-digit",
      month: "2-digit",
    }).formatToParts(d);
    const day = p.find((x) => x.type === "day")?.value || "??";
    const month = p.find((x) => x.type === "month")?.value || "??";
    return `${day}.${month}`;
  };
  const sh = mskHourMinute(start);
  const eh = mskHourMinute(end);
  const calStart =
    sh.h === 1 && sh.m === 0 ? new Date(start.getTime() - RACE_TRAIN_TAIL_MS) : start;
  const calEnd =
    eh.h === 1 && eh.m === 0 ? new Date(end.getTime() - RACE_TRAIN_TAIL_MS) : end;
  return `${fmt(calStart)} 00:00 — ${fmt(calEnd)} 01:00 МСК`;
}

export function nextRaceGoal(prev: number, met: boolean): number {
  const base = Math.max(1, Math.round(prev || RACE_BASE_GOAL));
  const next = Math.round(base * (met ? RACE_GOAL_UP : RACE_GOAL_DOWN));
  return Math.max(1, next);
}

export function mskWeekday(at: Date = new Date()): number {
  // 0=Sun … 6=Sat in MSK
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Moscow",
    weekday: "short",
  }).format(at);
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[wd] ?? at.getUTCDay();
}

export function formatRaceCountdown(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}
