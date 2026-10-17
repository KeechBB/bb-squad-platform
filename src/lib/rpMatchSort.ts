/** Pure match-list sort helpers — safe for client components (no node:fs). */

/** Chrono key: date then id (14-cslmutaha before 14-cslmutaha-2). */
export function rpMatchSortKey(m: { date?: string; id?: string }): string {
  return `${String(m.date || "")}\0${String(m.id || "")}`;
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
