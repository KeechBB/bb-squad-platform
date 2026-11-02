import { promises as fs } from "fs";
import path from "path";
import { BP_REWARDS, type BpReward } from "@/lib/battlePass";
import {
  hasBattlePassL20Reward,
  loadBattlePassState,
  progressForNick,
} from "@/lib/battlePassData";
import { prisma } from "@/lib/prisma";
import {
  isProfileShelfAward,
  resolveMedalShelfSlots,
  type ProfileMedalItem,
} from "@/lib/profileMedalsShared";

export {
  MEDAL_SHELF_SLOTS,
  isProfileShelfAward,
  normalizeMedalShelfIds,
  resolveMedalShelfSlots,
  type ProfileMedalItem,
  type ProfileMedalSlot,
} from "@/lib/profileMedalsShared";

const REGISTRATION_SIGN: ProfileMedalItem = {
  id: "site-registration",
  name: "Регистрация",
  short: "Знак",
  kind: "badge",
  level: 0,
  hover: "Знак регистрации на сайте",
  icon: "/awards/registration.png",
  source: "site",
};

const FRUIT_STRIKE_MVP: ProfileMedalItem = {
  id: "fruit-strike-mvp-v1",
  name: "MVP Fruit Strike",
  short: "MVP",
  kind: "medal",
  level: 0,
  hover: "Больше всего убийств на Fruit Strike Squad Cup #01",
  icon: "/awards/fruit-strike-mvp-v1.png",
  source: "site",
};

const KEECH_FRUIT_STRIKE_TROPHY: ProfileMedalItem = {
  id: "keech-fruit-strike-place1-trophy-v1",
  name: "Кубок «Алый урожай»",
  short: "1 место",
  kind: "medal",
  level: 0,
  hover: "Кубок «Алый урожай» · Награда за 1 место в Fruit Strike",
  icon: "/awards/fruit-strike-place1-trophy-v1.png",
  source: "site",
};

const KEECH_HALLOWEEN_TROPHY: ProfileMedalItem = {
  id: "keech-halloween-s2-trophy",
  name: "Кубок «Золотая тыква»",
  short: "S2 финал",
  kind: "medal",
  level: 0,
  hover: "Кубок «Золотая тыква» · Финал Halloween Season 2",
  icon: "/bp-halloween/trophy-v1.png",
  source: "site",
};

/** Медаль лучшему прогнозеру FSSC #1. Keech видит её и как превью. */
const KEECH_FSSC_PREDICTIONS_MEDAL: ProfileMedalItem = {
  id: "keech-fssc-predictions-medal-v1",
  name: "Медаль «Прогноз»",
  short: "FSSC #1",
  kind: "medal",
  level: 0,
  hover: "За лучшие прогнозы турнира FSSC #1",
  icon: "/awards/fssc-predictions-medal-v1.png",
  source: "site",
};

const BP_ICONS: Record<string, string> = {
  "pb1-scout-spark": "/bp-previews/l5-iskra.png",
  "pb1-gold-nick": "/bp-previews/l15-gold-nick.png",
  "pb1-aurum-clean": "/bp-previews/l15-gold-nick.png",
  "pb1-profile-customize": "/bp-assets/keech-m4a1-gold-standard-v2.png",
  "pb1-best-tester": "/awards/bp-s1-l20-pink-strawberry.png",
  "pb1-gold-bg": "/bp-previews/l5-iskra.png",
};

function iconFor(r: BpReward): string {
  return BP_ICONS[r.id] || "/bp-previews/l20-medal.png";
}

async function fruitStrikeAwardIds(userId: string): Promise<{
  trophy: boolean;
  mvp: boolean;
  prediction: boolean;
}> {
  try {
    const raw = await fs.readFile(
      path.join(process.cwd(), "data", "tournaments", "fruit-strike-s1-awards.json"),
      "utf8"
    );
    const data = JSON.parse(raw) as {
      trophyUserIds?: string[];
      mvpUserIds?: string[];
      predictionUserIds?: string[];
    };
    return {
      trophy: (data.trophyUserIds || []).includes(userId),
      mvp: (data.mvpUserIds || []).includes(userId),
      prediction: (data.predictionUserIds || []).includes(userId),
    };
  } catch {
    return { trophy: false, mvp: false, prediction: false };
  }
}

/** Все награды, которые игрок открыл (инвентарь для кастомизации). */
export async function buildPlayerMedalInventory(
  nick: string
): Promise<ProfileMedalItem[]> {
  const clean = String(nick || "").trim();
  if (!clean) return [];
  const state = await loadBattlePassState().catch(() => null);
  const prog = progressForNick(state, clean);
  const unlocked = (r: BpReward) => {
    if (r.level === 20 && hasBattlePassL20Reward(state, clean)) return true;
    return Boolean(prog.completedAt) || prog.currentLevel >= r.level;
  };

  const bp = BP_REWARDS.filter((r) => r.kind === "medal")
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
  const signs = registered ? [REGISTRATION_SIGN] : [];
  const award = registered
    ? await fruitStrikeAwardIds(registered.id)
    : { trophy: false, mvp: false, prediction: false };
  const keech = clean.toLowerCase() === "keech";
  const cups: ProfileMedalItem[] = [];
  if (award.trophy || keech) cups.push(KEECH_FRUIT_STRIKE_TROPHY);
  if (award.mvp) cups.push(FRUIT_STRIKE_MVP);
  if (award.prediction || keech) cups.push(KEECH_FSSC_PREDICTIONS_MEDAL);
  if (keech) cups.push(KEECH_HALLOWEEN_TROPHY);
  return [...cups, ...signs, ...bp].filter(isProfileShelfAward);
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
