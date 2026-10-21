import { BP_REWARDS, type BpReward, type BpRewardKind } from "@/lib/battlePass";
import {
  loadBattlePassState,
  progressForNick,
} from "@/lib/battlePassData";
import { prisma } from "@/lib/prisma";

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

const REGISTRATION_MEDAL: ProfileMedalItem = {
  id: "site-registration",
  name: "Регистрация",
  short: "Знак",
  kind: "medal",
  level: 0,
  hover: "Прошёл регистрацию на сайте",
  icon: "/awards/registration.png",
  source: "site",
};

const BP_ICONS: Record<string, string> = {
  "pb1-scout-spark": "/bp-previews/l5-iskra.png",
  "pb1-gold-nick": "/bp-previews/l15-gold-nick.png",
  "pb1-aurum-clean": "/bp-previews/l15-gold-nick.png",
  "pb1-profile-customize": "/bp-assets/keech-m4a1-gold-standard-v2.png",
  "pb1-best-tester": "/awards/bp-s1-l20-cobalt-core.png",
  "pb1-gold-bg": "/bp-previews/l5-iskra.png",
};

function iconFor(r: BpReward): string {
  return BP_ICONS[r.id] || "/bp-previews/l20-medal.png";
}

/** Все награды, которые игрок открыл (инвентарь для кастомизации). */
export async function buildPlayerMedalInventory(
  nick: string
): Promise<ProfileMedalItem[]> {
  const clean = String(nick || "").trim();
  if (!clean) return [];
  const state = await loadBattlePassState().catch(() => null);
  const prog = progressForNick(state, clean);
  const unlocked = (r: BpReward) =>
    Boolean(prog.completedAt) || prog.currentLevel >= r.level;

  // Полка / инвентарь «Награды» — медали, значки и нашивка L15.
  // Фон L5 и стиль ника L10 живут в других вкладках кастомизации.
  const bp = BP_REWARDS.filter(
    (r) => r.kind === "medal" || r.kind === "badge" || r.kind === "customize"
  )
    .filter(unlocked)
    .map((r) => ({
      id: r.id,
      name: r.name,
      short: r.short,
      kind: r.kind,
      level: r.level,
      hover: r.hover || r.preview || r.name,
      icon: iconFor(r),
      source: "bp" as const,
    }));

  const registered = await prisma.user.findFirst({
    where: {
      nick: { equals: clean, mode: "insensitive" },
      profileComplete: true,
    },
    select: { id: true },
  });

  return registered ? [REGISTRATION_MEDAL, ...bp] : bp;
}

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
 * Пустой выбор → авто первые из инвентаря (миграция / пока не настроил в кастомизации).
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

/** Награды на полке (без null) — совместимость со старым API. */
export async function buildPlayerMedalShelf(
  nick: string,
  selectedIds?: string[] | null
): Promise<ProfileMedalItem[]> {
  const inventory = await buildPlayerMedalInventory(nick);
  return resolveMedalShelfSlots(inventory, selectedIds).filter(
    (x): x is ProfileMedalItem => Boolean(x)
  );
}
