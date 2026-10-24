/** Нашивки ника (рейтинг паблика / КВ / тренировок). Файлы в /public/bp-assets/. */

import { SITE_CREATOR_STEAM_ID } from "@/lib/profileBg";

export const PROFILE_PATCH_OPTIONS = [
  {
    id: "bp-l15-keech",
    file: "keech-m4a1-gold-standard-v2.png",
    label: "M4A1 «Золотой стандарт» · BP L15",
    tip: "M4A1 «Золотой стандарт» · Награда за достижение 15 уровня Battle Pass Тестовый сезон",
    gate: "bp-l15" as const,
  },
  {
    id: "creator-orange-phantom",
    file: "keech-hidden-orange-phantom.png",
    label: "Протокол: Оранжевый призрак",
    tip: "Протокол: «Оранжевый призрак» · Как получить: скрытая награда",
    gate: "creator" as const,
  },
  {
    id: "creator-fruit-strike-ak-v2",
    file: "fruit-strike-place2-ak-v2.png",
    label: "АК «Цитрусовый шторм» · Fruit Strike",
    tip: "АК «Цитрусовый шторм» · Награда за 2 место в Fruit Strike",
    gate: "creator" as const,
  },
  {
    id: "hw2-knife-hook",
    file: "halloween-s2-knife-hook.png",
    label: "Крюк «Жнец сада» · Halloween S2",
    tip: "Крюк «Жнец сада» · Награда за 5 уровень Halloween Season 2",
    gate: "creator" as const,
  },
  {
    id: "hw2-ak-pumpkin",
    file: "halloween-s2-ak-pumpkin.png",
    label: "АК «Тыквенный магазин» · Halloween S2",
    tip: "АК «Тыквенный магазин» · Награда за 20 уровень Halloween Season 2",
    gate: "creator" as const,
  },
  {
    id: "public-100-vehicles-t62",
    file: "public-100-vehicles-t62-neon-harvest-v2.png",
    label: "Т-62 «Неоновый урожай»",
    tip: "Т-62 «Неоновый урожай» · Награда за 100 уничтоженных единиц техники на паблике «Фруктовый сад»",
    gate: "public-vehicles-100" as const,
  },
] as const;

export type ProfilePatchId = (typeof PROFILE_PATCH_OPTIONS)[number]["id"];

export type ProfilePatchChoice = {
  id: ProfilePatchId;
  file: string;
  label: string;
  tip: string;
};

export const BP_L15_PATCH_ID = "bp-l15-keech" as const satisfies ProfilePatchId;
export const PUBLIC_100_VEHICLES_PATCH_ID =
  "public-100-vehicles-t62" as const satisfies ProfilePatchId;

type PatchGate = "bp-l15" | "creator" | "public-vehicles-100";

function gateOf(opt: (typeof PROFILE_PATCH_OPTIONS)[number]): PatchGate {
  return opt.gate;
}

const BY_ID = new Map(
  PROFILE_PATCH_OPTIONS.map((o) => [o.id, o] as const)
);

export function isProfilePatchId(v: unknown): v is ProfilePatchId {
  return typeof v === "string" && BY_ID.has(v as ProfilePatchId);
}

export function normalizeProfilePatch(v: unknown): ProfilePatchId | null {
  if (v == null || v === "" || v === "none" || v === "default") return null;
  return isProfilePatchId(v) ? v : null;
}

export function profilePatchUrl(
  id: ProfilePatchId | null | undefined
): string | null {
  if (!id) return null;
  const opt = BY_ID.get(id);
  return opt ? `/bp-assets/${opt.file}` : null;
}

export function profilePatchTip(id: ProfilePatchId): string {
  return BY_ID.get(id)?.tip || BY_ID.get(id)?.label || id;
}

export function profilePatchLabel(id: ProfilePatchId): string {
  return BY_ID.get(id)?.label || id;
}

export function profilePatchChoicesFor(opts: {
  steamId: string;
  unlocks: readonly string[];
}): ProfilePatchChoice[] {
  const unlocks = new Set(opts.unlocks);
  return PROFILE_PATCH_OPTIONS.filter((opt) => {
    const gate = gateOf(opt);
    if (gate === "creator") {
      return opts.steamId === SITE_CREATOR_STEAM_ID;
    }
    if (gate === "bp-l15") {
      return (
        unlocks.has(opt.id) ||
        unlocks.has("pb1-gold-nick") ||
        unlocks.has("pb1-profile-customize")
      );
    }
    if (gate === "public-vehicles-100") {
      return unlocks.has(opt.id);
    }
    return false;
  }).map((opt) => ({
    id: opt.id,
    file: opt.file,
    label: opt.label,
    tip: opt.tip,
  }));
}

export function canUseProfilePatch(
  id: ProfilePatchId | null,
  opts: { steamId: string; unlocks: readonly string[] }
): boolean {
  if (!id) return true;
  return profilePatchChoicesFor(opts).some((opt) => opt.id === id);
}

export const PROFILE_PATCH_IDS = PROFILE_PATCH_OPTIONS.map(
  (o) => o.id
) as unknown as readonly ProfilePatchId[];
