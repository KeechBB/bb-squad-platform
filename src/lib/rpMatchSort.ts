/** Pure match-list sort helpers — safe for client components (no node:fs). */

/**
 * Chrono key: date, start time (HH:MM), then id.
 * Training ids are `18-cslmutaha` — alpha order is not play order.
 * Public ids already embed HHMM, so an empty time still sorts them.
 */
export function rpMatchSortKey(m: {
  date?: string;
  id?: string;
  time?: string;
}): string {
  return `${String(m.date || "")}\0${String(m.time || "")}\0${String(m.id || "")}`;
}

/** Newest first — history modals / career lists. */
export function sortRpMatchesNewestFirst<T extends { date?: string; id?: string }>(
  matches: T[]
): T[] {
  return [...matches].sort((a, b) =>
    rpMatchSortKey(b).localeCompare(rpMatchSortKey(a))
  );
}

/** Oldest first — ledger write / RP chain. */
export function sortRpMatchesOldestFirst<T extends { date?: string; id?: string }>(
  matches: T[]
): T[] {
  return [...matches].sort((a, b) =>
    rpMatchSortKey(a).localeCompare(rpMatchSortKey(b))
  );
}
