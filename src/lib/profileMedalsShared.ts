import type { BpRewardKind } from "@/lib/battlePass";

export const MEDAL_SHELF_SLOTS = 3;

export type ProfileMedalItem = {
  id: string;
  name: string;
  short: string;
  kind: BpRewardKind;
  level: number;
  hover: string;
  icon: string;
  source: "bp" | "site";
};

/** Слот полки: награда или пусто. */
export type ProfileMedalSlot = ProfileMedalItem | null;

export function normalizeMedalShelfIds(
  raw: unknown,
  ownedIds: Set<string>
): string[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of list) {
    const id = String(x || "").trim();
    if (!id || seen.has(id) || !ownedIds.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MEDAL_SHELF_SLOTS) break;
  }
  return out;
}

/**
 * 3 слота для полки.
 * Пустой выбор → авто первые из инвентаря (миграция / пока не настроил).
 */
export function resolveMedalShelfSlots(
  inventory: ProfileMedalItem[],
  selectedIds: string[] | null | undefined
): ProfileMedalSlot[] {
  const byId = new Map(inventory.map((m) => [m.id, m]));
  const owned = new Set(byId.keys());
  const picked = normalizeMedalShelfIds(selectedIds, owned);
  const ids =
    picked.length > 0
      ? picked
      : inventory.slice(0, MEDAL_SHELF_SLOTS).map((m) => m.id);

  const slots: ProfileMedalSlot[] = [];
  for (let i = 0; i < MEDAL_SHELF_SLOTS; i++) {
    const id = ids[i];
    slots.push(id ? byId.get(id) || null : null);
  }
  return slots;
}
