/** Логотипы кланов для клиента. Без KV и fs. */

const OPP_CANON: Record<string, { key: string; tag: string; name: string }> = {
  "20royals": { key: "20R", tag: "20R", name: "20Royals" },
  "20r": { key: "20R", tag: "20R", name: "20Royals" },
  avg: { key: "AVG", tag: "AVG", name: "AVANGUARD" },
  avanguard: { key: "AVG", tag: "AVG", name: "AVANGUARD" },
  dcai: { key: "DCAI", tag: "DCAI", name: "De Caelo Ad Inferos" },
  hell: { key: "HELL", tag: "HELL", name: "HELL" },
  two: { key: "TWO", tag: "TWO", name: "Tactical Worm Co." },
  "44th": { key: "44th", tag: "44th", name: "44th Comp Team" },
  ih: { key: "IH", tag: "IH", name: "Iron Horde" },
  gm: { key: "GM", tag: "GM", name: "Grand Masters" },
  hq: { key: "HQ", tag: "HQ", name: "HQ" },
  h1gh: { key: "H1GH", tag: "H1GH", name: "H1gh" },
  h1g: { key: "H1GH", tag: "H1GH", name: "H1gh" },
  alpha: { key: "ALPHA", tag: "ALPHA", name: "ALPHA" },
  sph: { key: "SPH", tag: "SPH", name: "SPH" },
  fury: { key: "FURY", tag: "FURY", name: "Fury" },
  imp: { key: "IMP", tag: "IMP", name: "IMP" },
  omen: { key: "OMEN", tag: "OMEN", name: "Team Omen" },
  fal: { key: "FAL", tag: "FAL", name: "FALCONS" },
  falcons: { key: "FAL", tag: "FAL", name: "FALCONS" },
  falcon: { key: "FAL", tag: "FAL", name: "FALCONS" },
  fox: { key: "FOX", tag: "FOX", name: "RED FOXES" },
  redfoxes: { key: "FOX", tag: "FOX", name: "RED FOXES" },
  solid: { key: "SOLID", tag: ".solid", name: ".SOLID" },
  ".solid": { key: "SOLID", tag: ".solid", name: ".SOLID" },
  bb: { key: "BB", tag: "BB", name: "BlackBerry" },
  blackberry: { key: "BB", tag: "BB", name: "BlackBerry" },
  "bb-main": { key: "BB-MAIN", tag: "BB", name: "BlackBerry Main" },
  "bb-junior": { key: "BB-JUNIOR", tag: "BB", name: "BlackBerry Junior" },
  main: { key: "BB-MAIN", tag: "BB", name: "BlackBerry Main" },
  junior: { key: "BB-JUNIOR", tag: "BB", name: "BlackBerry Junior" },
};

const LOGO_EXT: Record<string, string> = {
  BB: ".png",
  "BB-MAIN": ".png",
  "BB-JUNIOR": ".png",
  "20R": ".png",
  AVG: ".png",
  DCAI: ".png",
  HELL: ".png",
  TWO: ".png",
  "44th": ".png",
  IH: ".png",
  GM: ".png",
  HQ: ".png",
  H1GH: ".png",
  ALPHA: ".png",
  SPH: ".png",
  FURY: ".png",
  IMP: ".png",
  OMEN: ".png",
  FAL: ".png",
  FOX: ".png",
  SOLID: ".png",
};

function normKey(raw: string): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/^\[|\]$/g, "");
}

export function canonOpp(oppRaw: string) {
  const raw = String(oppRaw || "").trim();
  if (!raw) return { key: "?", tag: "?", name: "?" };

  // "[FAL] FALCONS" / "[BB] BlackBerry"
  const bracket = raw.match(/^\[([^\]]+)\]\s*(.*)$/);
  if (bracket) {
    const tagKey = normKey(bracket[1]);
    if (OPP_CANON[tagKey]) return OPP_CANON[tagKey];
    const nameKey = normKey(bracket[2] || bracket[1]);
    if (OPP_CANON[nameKey]) return OPP_CANON[nameKey];
    const tag = bracket[1].trim() || "?";
    const key = tag.toUpperCase();
    if (LOGO_EXT[key]) return { key, tag, name: bracket[2].trim() || tag };
    return { key, tag, name: bracket[2].trim() || tag };
  }

  const k = normKey(raw);
  if (OPP_CANON[k]) return OPP_CANON[k];

  // "FALCONS", "20Royals" без пробелов уже в k
  const tag = raw || "?";
  const key = tag.toUpperCase();
  if (LOGO_EXT[key]) return { key, tag: key, name: tag };
  return { key, tag, name: tag };
}

export function clanLogoUrl(key: string): string | null {
  const k = String(key || "").trim();
  if (!k) return null;
  // прямые ключи файлов
  if (LOGO_EXT[k]) return `/rating-logos/${k}${LOGO_EXT[k]}`;
  // через канон
  const c = canonOpp(k);
  if (LOGO_EXT[c.key]) return `/rating-logos/${c.key}${LOGO_EXT[c.key]}`;
  return null;
}

/** Надёжный URL лого для UI (всегда строка, с запасным BB/буквой через data URI нельзя — null ok). */
export function resolveClanLogo(
  oppOrKey: string,
  fallbackKey?: string | null
): string | null {
  return (
    clanLogoUrl(oppOrKey) ||
    (fallbackKey ? clanLogoUrl(fallbackKey) : null) ||
    null
  );
}
