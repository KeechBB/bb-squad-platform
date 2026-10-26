/**
 * Cutover: роли / попадания / окна залитых TM синхронизированы с TRAIN RP.
 * Env: BB_TRAIN_STATS_SINCE=YYYY-MM-DD (default 2026-10-20).
 */
export const TRAIN_STATS_SINCE_DEFAULT = "2026-10-20";

export function trainStatsSinceYmd(): string {
  const raw = (process.env.BB_TRAIN_STATS_SINCE || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return TRAIN_STATS_SINCE_DEFAULT;
}

/** max(requested, cutover) — null/empty → cutover. */
export function clampTrainStatsFromYmd(
  fromYmd?: string | null
): string {
  const since = trainStatsSinceYmd();
  const from = String(fromYmd || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return since;
  return from < since ? since : from;
}

export function isTrainStatsYmdOk(ymd: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) && ymd >= trainStatsSinceYmd();
}
