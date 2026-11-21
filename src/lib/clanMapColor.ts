/**
 * Стабильный цвет клана (карта игроков, список кланов, карточка).
 * Известные теги — фиксированная палитра; остальные — по hash id/tag.
 */

const KNOWN: Record<string, string> = {
  // сайт /clans — фиолетовый только у BB; красный/оранжевый/синий оставляем где уже стоят
  ХУХ: "#14b8a6",
  HIVE: "#ffe600",
  A: "#fbbf24",
  ALPHA: "#fbbf24",
  AUT: "#22d3ee",
  BB: "#a78bfa",
  BLR: "#94a3b8",
  DCAI: "#ef4444",
  DL: "#64748b",
  GRAD: "#3b82f6",
  IMP: "#991b1b",
  NKLV: "#0ea5e9",
  OCO: "#f97316",
  POHUY: "#2dd4bf",
  RA: "#f472b6",
  RPSS: "#84cc16",
  YSKUT: "#ec4899",
  // КВ / карта (внешние и старые)
  UKNOW: "#22d3ee",
  FOX: "#f97316",
  AVG: "#eab308",
  HELL: "#dc2626",
  TWO: "#84cc16",
  "20R": "#a3e635",
  "44TH": "#f59e0b",
  GM: "#64748b",
  SPH: "#facc15",
  IH: "#78716c",
  HQ: "#b91c1c",
  H1GH: "#ec4899",
  OMEN: "#2dd4bf",
  FURY: "#ea580c",
  FAL: "#0ea5e9",
  SOLID: "#16a34a",
};

/** 24 различимых цвета (без слишком тёмных). */
const PALETTE = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#84cc16",
  "#22c55e",
  "#14b8a6",
  "#06b6d4",
  "#0ea5e9",
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#a855f7",
  "#d946ef",
  "#ec4899",
  "#f43f5e",
  "#fb7185",
  "#fdba74",
  "#a3e635",
  "#2dd4bf",
  "#38bdf8",
  "#818cf8",
  "#c084fc",
  "#f472b6",
  "#94a3b8",
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
