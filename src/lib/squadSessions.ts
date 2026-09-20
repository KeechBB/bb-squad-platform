/** Squad server join/leave sessions for registered platform users. */

export type SquadSessionEventType = "join" | "leave";

export type SquadSessionIngestEvent = {
  type: SquadSessionEventType;
  steamId: string;
  eosId?: string | null;
  nick?: string | null;
  /** ISO-8601 UTC */
  at: string;
  serverKey?: string;
};

export function normalizeSteamId(raw: string): string | null {
  const s = raw.trim();
  // Steam64 = 17 digits, always starts with 7656
  if (!/^7656\d{13}$/.test(s)) return null;
  return s;
}

export function normalizeEosId(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/^redpointeos:/, "");
  if (!/^[0-9a-f]{32}$/.test(s)) return null;
  return s;
}

export function sessionEventKey(
  serverKey: string,
  steamId: string,
  joinedAt: Date
): string {
  return `${serverKey}|${steamId}|${joinedAt.getTime()}`;
}

/** МСК wall-clock helpers for attendance labels */
export function mskParts(d: Date): {
  y: number;
  m: number;
  day: number;
  h: number;
  min: number;
} {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(d).map((p) => [p.type, p.value])
  ) as Record<string, string>;
  return {
    y: Number(parts.year),
    m: Number(parts.month),
    day: Number(parts.day),
    h: Number(parts.hour),
    min: Number(parts.minute),
  };
}

export function formatMskDateTime(d: Date): string {
  const p = mskParts(d);
  const hh = String(p.h).padStart(2, "0");
  const mm = String(p.min).padStart(2, "0");
  const dd = String(p.day).padStart(2, "0");
  const mo = String(p.m).padStart(2, "0");
  return `${dd}.${mo}.${p.y} ${hh}:${mm}`;
}

export function formatDurationMinutes(
  joinedAt: Date,
  leftAt: Date | null,
  now = new Date()
): number {
  const end = leftAt ?? now;
  const ms = Math.max(0, end.getTime() - joinedAt.getTime());
  return Math.round(ms / 60000);
}

/**
 * Метка относительно канона тренировки 21:00 МСК.
 * on_time ≤ 21:00, late_ok ≤ 21:30, иначе late. Только если заход вечером (с 18:00).
 */
export type AttendanceTag = "on_time" | "late_ok" | "late" | "other";

/** Старт учёта посещаемости (логов раньше нет). Дальше — по месяцам. */
export const ATTENDANCE_CANON_START_YMD = "2026-09-15";

/** Начало 15.09.2026 МСК в UTC */
export function attendanceCanonStartUtc(): Date {
  return new Date(Date.UTC(2026, 8, 14, 21, 0, 0));
}

export function clampAttendanceFromYmd(fromYmd: string): string {
  return fromYmd < ATTENDANCE_CANON_START_YMD
    ? ATTENDANCE_CANON_START_YMD
    : fromYmd;
}

export function attendanceTag(joinedAt: Date): AttendanceTag {
  const p = mskParts(joinedAt);
  const mins = p.h * 60 + p.min;
  if (mins < 18 * 60) return "other";
  if (mins <= 21 * 60) return "on_time";
  if (mins <= 21 * 60 + 30) return "late_ok";
  return "late";
}

export const ATTENDANCE_LABEL: Record<AttendanceTag, string> = {
  on_time: "вовремя",
  late_ok: "с 21:00–21:30",
  late: "после 21:30",
  other: "день",
};
