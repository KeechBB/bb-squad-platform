/** Варианты фона профиля (файлы в /public/profile-bgs/). */

export const PROFILE_BG_OPTIONS = [
  { id: "01", file: "variant-01.jpg", label: "Вариант 1" },
  { id: "02", file: "variant-02.jpg", label: "Вариант 2" },
  { id: "03", file: "variant-03.jpg", label: "Вариант 3" },
  { id: "04", file: "variant-04.jpg", label: "Вариант 4" },
  { id: "05", file: "variant-05.jpg", label: "Вариант 5" },
  { id: "06", file: "variant-06.jpg", label: "Вариант 6" },
  { id: "07", file: "variant-07.jpg", label: "Вариант 7" },
  { id: "anime-01", file: "anime-squad-01.jpg", label: "Anime Squad 1" },
  { id: "anime-02", file: "anime-squad-02.jpg", label: "Anime Squad 2" },
  {
    id: "girls-01",
    file: "anime-squad-girls-01.jpg",
    label: "Anime Squad Girls 1",
  },
  {
    id: "girls-02",
    file: "anime-squad-girls-02.jpg",
    label: "Anime Squad Girls 2",
  },
] as const;

export type ProfileBgId = (typeof PROFILE_BG_OPTIONS)[number]["id"];

export const PROFILE_BG_IDS = PROFILE_BG_OPTIONS.map((o) => o.id) as unknown as readonly ProfileBgId[];

const BY_ID = new Map(
  PROFILE_BG_OPTIONS.map((o) => [o.id, o] as const)
);

export function isProfileBgId(v: unknown): v is ProfileBgId {
  return typeof v === "string" && BY_ID.has(v as ProfileBgId);
}

export function profileBgUrl(id: ProfileBgId | null | undefined): string | null {
  if (!id) return null;
  const opt = BY_ID.get(id);
  return opt ? `/profile-bgs/${opt.file}` : null;
}

export function profileBgLabel(id: ProfileBgId): string {
  return BY_ID.get(id)?.label || id;
}

export function normalizeProfileBg(v: unknown): ProfileBgId | null {
  if (v == null || v === "" || v === "none" || v === "default") return null;
  return isProfileBgId(v) ? v : null;
}
