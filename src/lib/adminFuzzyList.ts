/** Fold lookalike Latin/Cyrillic so «pasha» ≈ «раsha» / «Паша». */
const FOLD_MAP: Record<string, string> = {
  а: "a",
  е: "e",
  ё: "e",
  о: "o",
  р: "p",
  с: "c",
  х: "x",
  у: "y",
  к: "k",
  м: "m",
  н: "h",
  в: "b",
  т: "t",
  і: "i",
  ї: "i",
  ӏ: "l",
};

export function foldSearch(raw: string): string {
  return Array.from(String(raw || "").toLowerCase())
    .map((ch) => FOLD_MAP[ch] || ch)
    .join("");
}

export function fuzzyIncludes(haystack: string, needle: string): boolean {
  const n = foldSearch(needle).trim();
  if (!n) return true;
  const h = foldSearch(haystack);
  if (h.includes(n)) return true;
  // subsequence for short typos / partial nick
  if (n.length >= 2 && n.length <= 24) {
    let i = 0;
    for (const ch of h) {
      if (ch === n[i]) i += 1;
      if (i >= n.length) return true;
    }
  }
  return false;
}

export function fuzzyScore(haystack: string, needle: string): number {
  const n = foldSearch(needle).trim();
  if (!n) return 0;
  const h = foldSearch(haystack);
  if (h === n) return 100;
  if (h.startsWith(n)) return 90;
  const idx = h.indexOf(n);
  if (idx >= 0) return 80 - Math.min(40, idx);
  if (fuzzyIncludes(haystack, needle)) return 40;
  return 0;
}

export type SortDir = "asc" | "desc";

export function compareLoose(a: unknown, b: unknown, dir: SortDir): number {
  const av = a == null || a === "" ? null : a;
  const bv = b == null || b === "" ? null : b;
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  let cmp = 0;
  if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
  else {
    const as = foldSearch(String(av));
    const bs = foldSearch(String(bv));
    cmp = as < bs ? -1 : as > bs ? 1 : 0;
  }
  return dir === "asc" ? cmp : -cmp;
}

export const ADMIN_PAGE_SIZE = 50;
