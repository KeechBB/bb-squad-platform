/** Inclusive calendar-day span between two UTC-midnight dates. */
export function inclusiveCalendarDays(from: Date, until: Date): number {
  const a = Date.UTC(
    from.getUTCFullYear(),
    from.getUTCMonth(),
    from.getUTCDate()
  );
  const b = Date.UTC(
    until.getUTCFullYear(),
    until.getUTCMonth(),
    until.getUTCDate()
  );
  return Math.floor((b - a) / 86_400_000) + 1;
}

/** Self day-off: 1–3 days inclusive. */
export const DAY_OFF_MIN_DAYS = 1;
export const DAY_OFF_MAX_DAYS = 3;
/** Self reserve: from 4 days inclusive, no upper cap. */
export const RESERVE_MIN_DAYS = 4;

export function todayUtcMidnight(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  );
}

export function addDaysUtc(d: Date, delta: number): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + delta)
  );
}
