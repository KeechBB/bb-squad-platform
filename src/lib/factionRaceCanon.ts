/** Канон гонки фракций / принуд. штрафа. Легион вне системы. */

/** 21.11.2026 00:00 МСК — старт эпохи недельных окон. */
export const RACE_EPOCH_START = new Date("2026-11-20T21:00:00.000Z");
export const RACE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const RACE_GRACE_MS = 24 * 60 * 60 * 1000;
export const RACE_BASE_GOAL = 400_000;
export const RACE_GOAL_UP = 1.05;
export const RACE_GOAL_DOWN = 0.95;

export const RACE_FACTION_NAMES = ["Орда", "Улей", "Сброд", "Стая", "Табор"] as const;

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

export function raceWindowAt(at: Date = new Date()): RaceWindowBounds | null {
  const ms = at.getTime() - RACE_EPOCH_START.getTime();
  if (ms < 0) return null;
  const index = Math.floor(ms / RACE_WINDOW_MS);
  const start = new Date(RACE_EPOCH_START.getTime() + index * RACE_WINDOW_MS);
  const end = new Date(start.getTime() + RACE_WINDOW_MS);
  return { id: raceMskYmd(start), index, start, end };
}

export function raceWindowByIndex(index: number): RaceWindowBounds {
  const start = new Date(RACE_EPOCH_START.getTime() + index * RACE_WINDOW_MS);
  const end = new Date(start.getTime() + RACE_WINDOW_MS);
  return { id: raceMskYmd(start), index, start, end };
}

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
  return `${fmt(start)} 00:00 — ${fmt(end)} 00:00 МСК`;
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
