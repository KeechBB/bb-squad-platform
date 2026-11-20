/**
 * Редкость нашивок (кейсы / рейтинг).
 * Канон согласования с Alex 20.11.2026.
 */

export type PatchRarity =
  | "immortal"
  | "rare"
  | "excellent"
  | "interesting"
  | "common";

export const PATCH_RARITY_LABEL: Record<PatchRarity, string> = {
  immortal: "Immortal",
  rare: "Rare",
  excellent: "Отличное",
  interesting: "Интересное",
  common: "Обычное",
};

/** Immortal — ультра из кейса (СВД / РГ-6). */
const IMMORTAL = new Set([
  "creator-svd-faction-lord",
  "creator-gp-drum-berry-lore",
]);

/** Rare — скрытый протокол, BP L15, турнир, РПГ. */
const RARE = new Set([
  "creator-orange-phantom",
  "bp-l15-keech",
  "creator-fruit-strike-ak-v2",
  "creator-rpg7-orchard-harvest",
]);

/** Отличное — фракционные B$. */
const EXCELLENT = new Set([
  "bd-faction-legion-ak74",
  "bd-faction-orda-m4a1",
  "bd-faction-sbord-scar",
  "bd-faction-staya-svd",
  "bd-faction-tabor-m4",
  "bd-faction-uley-pkm",
]);

/** Интересное — ивент/сезон средний тир. */
const INTERESTING = new Set([
  "public-100-vehicles-t62",
  "hw2-ak-pumpkin",
  "hw2-knife-hook",
]);

/** Обычное — ивент дня. */
const COMMON = new Set([
  "creator-event-scar-lemon",
  "creator-event-saiga-apple",
]);

export function patchRarity(id: string | null | undefined): PatchRarity | null {
  if (!id) return null;
  if (IMMORTAL.has(id)) return "immortal";
  if (RARE.has(id)) return "rare";
  if (EXCELLENT.has(id)) return "excellent";
  if (INTERESTING.has(id)) return "interesting";
  if (COMMON.has(id)) return "common";
  return null;
}

export function patchRarityLabel(id: string | null | undefined): string | null {
  const r = patchRarity(id);
  return r ? PATCH_RARITY_LABEL[r] : null;
}

export function patchRarityClass(id: string | null | undefined): string {
  const r = patchRarity(id);
  if (!r) return "";
  return `is-${r}`;
}
