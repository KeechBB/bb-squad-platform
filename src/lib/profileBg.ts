/** Варианты фона профиля (файлы в /public/profile-bgs/). */

export const PROFILE_BG_OPTIONS = [
  { id: "02", file: "variant-02.jpg", label: "Вариант 2" },
  { id: "06", file: "variant-06.jpg", label: "Вариант 6" },
  {
    id: "creator-royal-core",
    file: "profile-bg-keech-blackberry-royal-core.jpg",
    label: "Keech · BlackBerry Royal Core",
    gate: "creator",
  },
  {
    id: "creator-fruit-strike-place3-v3",
    file: "fruit-strike-place3-bg-v3.jpg",
    label: "Fruit Strike · Тактический урожай",
    gate: "creator",
  },
  {
    id: "hw2-night-harvest",
    file: "halloween-s2-night-harvest.jpg",
    label: "Halloween S2 · Ночной урожай",
    gate: "bp-hw2",
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

type ProfileBgGate = "public" | "creator" | "bp-l5" | "bp-hw2";

function gateOf(opt: (typeof PROFILE_BG_OPTIONS)[number]): ProfileBgGate {
  return "gate" in opt ? (opt.gate as ProfileBgGate) : "public";
}

export function profileBgChoicesFor(opts: {
  steamId: string;
  unlocks: readonly string[];
}): ProfileBgChoice[] {
  const unlocks = new Set(opts.unlocks);
  return PROFILE_BG_OPTIONS.filter((opt) => {
    const gate = gateOf(opt);
    if (gate === "public") return true;
    if (gate === "creator") {
      if (opt.id === "creator-fruit-strike-place3-v3" && unlocks.has(opt.id)) {
        return true;
      }
      return opts.steamId === SITE_CREATOR_STEAM_ID;
    }
    if (gate === "bp-l5") {
      return (
        unlocks.has(opt.id) ||
        (opt.id === "bp-l5-gold" && unlocks.has("creator-tournament-02"))
      );
    }
    if (gate === "bp-hw2") {
      return unlocks.has(opt.id) || opts.steamId === SITE_CREATOR_STEAM_ID;
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
  // временные A–D → финальный «Туманный центр»
  "hw2-night-harvest-a": "hw2-night-harvest",
  "hw2-night-harvest-b": "hw2-night-harvest",
  "hw2-night-harvest-c": "hw2-night-harvest",
  "hw2-night-harvest-d": "hw2-night-harvest",
};

export function normalizeProfileBg(v: unknown): ProfileBgId | null {
  if (v == null || v === "" || v === "none" || v === "default") return null;
  if (typeof v !== "string") return null;
  const aliased = PROFILE_BG_ALIASES[v];
  if (aliased) return aliased;
  return isProfileBgId(v) ? v : null;
}
