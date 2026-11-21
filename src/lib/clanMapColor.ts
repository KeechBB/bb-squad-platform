/**
 * Стабильный цвет клана (карта игроков, ники в панельке).
 * Красный / оранжевый / синий заняты ролями (админ / мод / камера).
 * Фиолетовый канон только у BlackBerry (#9017c8).
 */

const KNOWN: Record<string, string> = {
  // сайт /clans
  ХУХ: "#34d399",
  HIVE: "#ffe600",
  A: "#facc15",
  ALPHA: "#facc15",
  AUT: "#22c55e",
  BB: "#9017c8",
  BBR: "#9017c8",
  BLR: "#94a3b8",
  DCAI: "#f472b6",
  DL: "#64748b",
  GRAD: "#84cc16",
  IMP: "#ec4899",
  NKLV: "#a3e635",
  OCO: "#fde047",
  POHUY: "#4ade80",
  RA: "#f9a8d4",
  RPSS: "#86efac",
  YSKUT: "#f472b6",
  // КВ / карта (внешние и старые)
  UKNOW: "#22c55e",
  FOX: "#facc15",
  AVG: "#eab308",
  HELL: "#f472b6",
  TWO: "#84cc16",
  "20R": "#a3e635",
  "44TH": "#fde047",
  GM: "#64748b",
  SPH: "#fef08a",
  IH: "#78716c",
  HQ: "#ec4899",
  H1GH: "#f9a8d4",
  OMEN: "#34d399",
  FURY: "#fde047",
  FAL: "#86efac",
  SOLID: "#16a34a",
};

/** Палитра без красного / оранжевого / синего / фиолетового. */
const PALETTE = [
  "#eab308",
  "#facc15",
  "#fde047",
  "#fef08a",
  "#84cc16",
  "#a3e635",
  "#22c55e",
  "#16a34a",
  "#34d399",
  "#4ade80",
  "#86efac",
  "#ec4899",
  "#f472b6",
  "#fb7185",
  "#f9a8d4",
  "#94a3b8",
  "#64748b",
  "#78716c",
];

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Тег без скобок/точек: •HIVE• → HIVE, (ХУХ) → ХУХ */
export function normalizeClanTag(tag?: string | null): string {
  return String(tag || "")
    .trim()
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function clanMapColor(clanId: string, tag?: string | null): string {
  const t = normalizeClanTag(tag);
  if (t && KNOWN[t]) return KNOWN[t];
  const key = clanId || t || "x";
  return PALETTE[hashStr(key) % PALETTE.length];
}

/** Лёгкий сдвиг координат, чтобы точки разных кланов в одном городе не слипались. */
export function clanPinJitter(clanId: string): { dLat: number; dLon: number } {
  const h = hashStr(clanId || "x");
  const a = ((h % 360) * Math.PI) / 180;
  const r = 0.04 + ((h >>> 8) % 40) / 1000; // ~0.04–0.08°
  return { dLat: Math.sin(a) * r, dLon: Math.cos(a) * r };
}
