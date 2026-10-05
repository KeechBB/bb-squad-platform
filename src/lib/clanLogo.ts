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
  cut: { key: "CUT", tag: "CUT", name: "CUT" },
  omen: { key: "OMEN", tag: "OMEN", name: "Team Omen" },
};

const LOGO_EXT: Record<string, string> = {
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
  CUT: ".png",
  OMEN: ".png",
};

export function canonOpp(oppRaw: string) {
  const raw = String(oppRaw || "").trim();
  const k = raw.toLowerCase().replace(/\s+/g, "");
  if (OPP_CANON[k]) return OPP_CANON[k];
  const tag = raw || "?";
  return { key: tag.toUpperCase(), tag, name: tag };
}

export function clanLogoUrl(key: string): string | null {
  const ext = LOGO_EXT[key];
  if (!ext) return null;
  return `/rating-logos/${key}${ext}`;
}
