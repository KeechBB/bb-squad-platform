import { BP_REWARDS, type BpReward, type BpRewardKind } from "@/lib/battlePass";
import {
  loadBattlePassState,
  progressForNick,
} from "@/lib/battlePassData";
import { prisma } from "@/lib/prisma";

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
  "pb1-profile-customize": "/bp-assets/l15-nick-patch-keech-test.png",
  "pb1-best-tester": "/bp-previews/l20-medal.png",
};

function iconFor(r: BpReward): string {
  return BP_ICONS[r.id] || "/bp-previews/l20-medal.png";
}

/** Награды BP, которые игрок уже открыл (ур. достигнут или сезон закрыт). */
export async function buildPlayerMedalShelf(
  nick: string
): Promise<ProfileMedalItem[]> {
  const clean = String(nick || "").trim();
  if (!clean) return [];
  const state = await loadBattlePassState().catch(() => null);
  const prog = progressForNick(state, clean);
  const unlocked = (r: BpReward) =>
    Boolean(prog.completedAt) || prog.currentLevel >= r.level;

  // Полка «Награды» — медали, значки и нашивка L15.
  // Фон L5 и стиль ника L10 живут в «Кастомизации профиля».
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
