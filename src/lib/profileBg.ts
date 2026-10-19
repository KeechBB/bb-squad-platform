/** Варианты фона профиля (файлы в /public/profile-bgs/). */

export const PROFILE_BG_IDS = [
  "01",
  "02",
  "03",
  "04",
  "05",
  "06",
  "07",
] as const;

export type ProfileBgId = (typeof PROFILE_BG_IDS)[number];

export function isProfileBgId(v: unknown): v is ProfileBgId {
  return typeof v === "string" && (PROFILE_BG_IDS as readonly string[]).includes(v);
}

export function profileBgUrl(id: ProfileBgId | null | undefined): string | null {
  if (!id || !isProfileBgId(id)) return null;
  return `/profile-bgs/variant-${id}.jpg`;
}

export function normalizeProfileBg(v: unknown): ProfileBgId | null {
  if (v == null || v === "" || v === "none" || v === "default") return null;
  return isProfileBgId(v) ? v : null;
}
