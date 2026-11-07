/**
 * Канон цветов фракций BlackBerry — всегда эти, не из логотипа и не «на глаз».
 * Ключ: имя/slug без пробелов и регистра.
 */
const FACTION_CANON_COLORS: Record<string, string> = {
  орда: "#ef4444",
  улей: "#facc15",
  сброд: "#22c55e",
  легион: "#f97316",
  стая: "#3b82f6",
  табор: "#a855f7",
};

function colorKey(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[\s_-]+/g, "");
}

/** Канон по имени или slug. Нет в таблице — null. */
export function factionCanonColor(...parts: (string | null | undefined)[]): string | null {
  for (const part of parts) {
    if (!part) continue;
    const hit = FACTION_CANON_COLORS[colorKey(part)];
    if (hit) return hit;
  }
  return null;
}

/** Цвет для UI: канон, иначе fallback. */
export function factionUiColor(
  name: string,
  slug?: string | null,
  fallback = "#f4f0e8"
): string {
  return factionCanonColor(name, slug) || fallback;
}
