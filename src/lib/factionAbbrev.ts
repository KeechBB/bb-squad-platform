/**
 * Short faction labels for scoreboards (PLA, CAF, …).
 * Known Squad tags first; otherwise initials of words.
 */
const KNOWN: Record<string, string> = {
  "people's liberation army": "PLA",
  "peoples liberation army": "PLA",
  "canadian armed forces": "CAF",
  "british armed forces": "BAF",
  "australian defence force": "ADF",
  "australian defense force": "ADF",
  "united states army": "USA",
  "united states marine corps": "USMC",
  "us marine corps": "USMC",
  "russian ground forces": "RGF",
  "russian airborne forces": "VDV",
  "middle eastern alliance": "MEA",
  "insurgent forces": "INS",
  "irregular militia forces": "IMF",
  "irregular militia": "IMF",
  "western private military contractors": "WPMC",
  "private military contractors": "PMC",
  "pla navy marine corps": "PLANMC",
  "people's liberation army navy marine corps": "PLANMC",
  "canadian army": "CAF",
  "turkish land forces": "TLF",
  "turkish armed forces": "TLF",
  "argentine army": "ARA",
  "brazilian army": "EB",
};

function normalizeKey(raw: string): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[''′]/g, "'")
    .replace(/\s+/g, " ");
}

/** PEOPLE'S LIBERATION ARMY → PLA; USA stays USA. */
export function abbreviateFaction(raw: string): string {
  const s = String(raw || "").trim();
  if (!s || s === "—") return s || "—";
  const key = normalizeKey(s);
  if (KNOWN[key]) return KNOWN[key];
  // Already a short tag (USA, RGF, ЗЧВК, PLANMC)
  if (/^[A-Za-zА-Яа-яЁё0-9]{2,8}$/u.test(s) && !/\s/.test(s)) {
    return s.toUpperCase();
  }
  const parts = s.split(/[\s\-_./]+/).filter(Boolean);
  if (parts.length >= 2) {
    const abbr = parts
      .map((w) => w[0] || "")
      .join("")
      .toUpperCase();
    if (abbr.length >= 2 && abbr.length <= 8) return abbr;
  }
  return s.length > 10 ? s.slice(0, 8).toUpperCase() : s.toUpperCase();
}
