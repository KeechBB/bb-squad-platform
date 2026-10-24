/** Стили ника в рейтингах (паблик / КВ / тренировки). */

import { SITE_CREATOR_STEAM_ID } from "@/lib/profileBg";

export const PROFILE_NICK_STYLE_OPTIONS = [
  {
    id: "bp-l10-aurum-clean",
    label: "Aurum Clean",
    tip: "Металлический золотой ник · Награда за 10 уровень Battle Pass",
    cssClass: "is-metallic-gold",
    gate: "bp-l10" as const,
  },
  {
    id: "hw2-violet-gothic",
    label: "Фиолетовая готика",
    tip: "Фиолетовый готический ник с кислотно-зелёной подсветкой · Награда за 15 уровень Halloween Season 2",
    cssClass: "is-halloween-gothic",
    gate: "creator" as const,
  },
] as const;

export type ProfileNickStyleId =
  (typeof PROFILE_NICK_STYLE_OPTIONS)[number]["id"];

export type ProfileNickStyleChoice = {
  id: ProfileNickStyleId;
  label: string;
  tip: string;
  cssClass: string;
};

export const BP_L10_NICK_STYLE_ID =
  "bp-l10-aurum-clean" as const satisfies ProfileNickStyleId;

export const HW2_NICK_STYLE_ID =
  "hw2-violet-gothic" as const satisfies ProfileNickStyleId;

const BY_ID = new Map(
  PROFILE_NICK_STYLE_OPTIONS.map((option) => [option.id, option] as const)
);

export function isProfileNickStyleId(
  value: unknown
): value is ProfileNickStyleId {
  return (
    typeof value === "string" && BY_ID.has(value as ProfileNickStyleId)
  );
}

export function normalizeProfileNickStyle(
  value: unknown
): ProfileNickStyleId | null {
  if (
    value == null ||
    value === "" ||
    value === "none" ||
    value === "default"
  ) {
    return null;
  }
  return isProfileNickStyleId(value) ? value : null;
}

export function profileNickStyleChoicesFor(opts: {
  unlocks: readonly string[];
  steamId?: string;
}): ProfileNickStyleChoice[] {
  const unlocks = new Set(opts.unlocks);
  return PROFILE_NICK_STYLE_OPTIONS.filter((option) => {
    if (option.gate === "bp-l10") {
      return unlocks.has(option.id);
    }
    if (option.gate === "creator") {
      return opts.steamId === SITE_CREATOR_STEAM_ID;
    }
    return false;
  }).map((option) => ({
    id: option.id,
    label: option.label,
    tip: option.tip,
    cssClass: option.cssClass,
  }));
}

export function canUseProfileNickStyle(
  id: ProfileNickStyleId | null,
  opts: { unlocks: readonly string[]; steamId?: string }
): boolean {
  if (!id) return true;
  return profileNickStyleChoicesFor(opts).some((option) => option.id === id);
}

export function profileNickStyleCssClass(
  id: ProfileNickStyleId | null | undefined
): string | null {
  if (!id) return null;
  return BY_ID.get(id)?.cssClass || null;
}

export function profileNickStyleTip(id: ProfileNickStyleId): string {
  return BY_ID.get(id)?.tip || BY_ID.get(id)?.label || id;
}

export const PROFILE_NICK_STYLE_IDS = PROFILE_NICK_STYLE_OPTIONS.map(
  (option) => option.id
) as unknown as readonly ProfileNickStyleId[];
