import { BP_REWARDS, type BpReward } from "@/lib/battlePass";
import {
  loadBattlePassState,
  progressForNick,
} from "@/lib/battlePassData";
import { prisma } from "@/lib/prisma";
import {
  MEDAL_SHELF_SLOTS,
  normalizeMedalShelfIds,
  resolveMedalShelfSlots,
  type ProfileMedalItem,
} from "@/lib/profileMedalsShared";

export {
  MEDAL_SHELF_SLOTS,
  normalizeMedalShelfIds,
  resolveMedalShelfSlots,
  type ProfileMedalItem,
  type ProfileMedalSlot,
} from "@/lib/profileMedalsShared";

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

const KEECH_FRUIT_STRIKE_TROPHY_TRIALS: ProfileMedalItem[] = [
  {
    id: "keech-fruit-strike-place1-trophy-v1",
    name: "Кубок «Алый урожай»",
    short: "1 место · V1",
    kind: "medal",
    level: 0,
    hover:
      "Кубок «Алый урожай» · Тест награды Fruit Strike за 1 место · Вариант 1",
    icon: "/awards/fruit-strike-place1-trophy-v1.png",
    source: "site",
  },
  {
    id: "keech-fruit-strike-place1-trophy-v2",
    name: "Кубок «Фруктовый фронт»",
    short: "1 место · V2",
    kind: "medal",
    level: 0,
    hover:
      "Кубок «Фруктовый фронт» · Тест награды Fruit Strike за 1 место · Вариант 2",
    icon: "/awards/fruit-strike-place1-trophy-v2.png",
    source: "site",
  },
  {
    id: "keech-fruit-strike-place1-trophy-v3",
    name: "Кубок «Сад чемпионов»",
    short: "1 место · V3",
    kind: "medal",
    level: 0,
    hover:
      "Кубок «Сад чемпионов» · Тест награды Fruit Strike за 1 место · Вариант 3",
    icon: "/awards/fruit-strike-place1-trophy-v3.png",
    source: "site",
  },
];

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

  const inventory = registered ? [REGISTRATION_MEDAL, ...bp] : bp;
  return clean.toLowerCase() === "keech"
    ? [...KEECH_FRUIT_STRIKE_TROPHY_TRIALS, ...inventory]
    : inventory;
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
