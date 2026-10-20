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
  { id: "cats-01", file: "anime-cats-01.jpg", label: "Anime Cats" },
  { id: "wolves-01", file: "anime-wolves-01.jpg", label: "Anime Wolves" },
  {
    id: "trucks-01",
    file: "profile-bg-semi-trucks-01.jpg",
    label: "Фуры",
  },
  {
    id: "creator-keech",
    file: "profile-bg-site-creator-keech.jpg",
    label: "Создатель сайта",
    gate: "creator",
  },
  {
    id: "creator-tournament-01",
    file: "profile-bg-keech-gold-tournament-01.jpg",
    label: "Keech · Турнирное золото I",
    gate: "creator",
  },
  {
    id: "creator-tournament-03",
    file: "profile-bg-keech-gold-tournament-03.jpg",
    label: "Keech · Турнирное золото III",
    gate: "creator",
  },
  {
    id: "bp-l5-gold",
    file: "profile-bg-keech-gold-tournament-02.jpg",
    label: "Турнирное золото II",
    gate: "bp-l5",
  },
] as const;

export type ProfileBgId = (typeof PROFILE_BG_OPTIONS)[number]["id"];

export type ProfileBgChoice = {
  id: ProfileBgId;
  file: string;
  label: string;
};

/** Аккаунт создателя сайта. Не путать с другими админами из env. */
export const SITE_CREATOR_STEAM_ID = "76561198028435874";

export const BP_L5_PROFILE_BG_ID = "bp-l5-gold" as const satisfies ProfileBgId;

type ProfileBgGate = "public" | "creator" | "bp-l5";

function gateOf(opt: (typeof PROFILE_BG_OPTIONS)[number]): ProfileBgGate {
  return "gate" in opt ? opt.gate : "public";
}

export function profileBgChoicesFor(opts: {
  steamId: string;
  unlocks: readonly string[];
}): ProfileBgChoice[] {
  const unlocks = new Set(opts.unlocks);
  return PROFILE_BG_OPTIONS.filter((opt) => {
    const gate = gateOf(opt);
    if (gate === "public") return true;
    if (gate === "creator") return opts.steamId === SITE_CREATOR_STEAM_ID;
    if (gate === "bp-l5") {
      return (
        unlocks.has(opt.id) ||
        (opt.id === "bp-l5-gold" && unlocks.has("creator-tournament-02"))
      );
    }
    return false;
  }).map((opt) => ({ id: opt.id, file: opt.file, label: opt.label }));
}

export function canUseProfileBg(
  id: ProfileBgId | null,
  opts: { steamId: string; unlocks: readonly string[] }
): boolean {
  if (!id) return true;
  return profileBgChoicesFor(opts).some((opt) => opt.id === id);
}

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

/** Старые id → актуальные (после смены награды L5). */
const PROFILE_BG_ALIASES: Record<string, ProfileBgId> = {
  "creator-tournament-02": "bp-l5-gold",
};

export function normalizeProfileBg(v: unknown): ProfileBgId | null {
  if (v == null || v === "" || v === "none" || v === "default") return null;
  if (typeof v !== "string") return null;
  const aliased = PROFILE_BG_ALIASES[v];
  if (aliased) return aliased;
  return isProfileBgId(v) ? v : null;
}
