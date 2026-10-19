import { prisma } from "@/lib/prisma";
import {
  BP_L5_PROFILE_BG_ID,
  profileBgChoicesFor,
  type ProfileBgChoice,
} from "@/lib/profileBg";
import {
  loadBattlePassState,
  progressForNick,
} from "@/lib/battlePassData";

/**
 * Золотой фон ур. 5 пишется в инвентарь один раз и больше не снимается,
 * даже если сезон Battle Pass обнулят.
 */
export async function ensureBpL5ProfileBg(user: {
  id: string;
  nick: string | null;
  unlockedProfileBgs: string[];
}): Promise<string[]> {
  const unlocks = [...(user.unlockedProfileBgs || [])];
  if (unlocks.includes(BP_L5_PROFILE_BG_ID)) return unlocks;
  const nick = String(user.nick || "").trim();
  if (!nick) return unlocks;

  const state = await loadBattlePassState().catch(() => null);
  const prog = progressForNick(state, nick);
  if (prog.currentLevel < 5 && !prog.completedAt) return unlocks;

  unlocks.push(BP_L5_PROFILE_BG_ID);
  await prisma.user.update({
    where: { id: user.id },
    data: { unlockedProfileBgs: unlocks },
  });
  return unlocks;
}

export async function profileBgChoicesForUser(user: {
  id: string;
  steamId: string;
  nick: string | null;
  unlockedProfileBgs: string[];
}): Promise<ProfileBgChoice[]> {
  const unlocks = await ensureBpL5ProfileBg(user);
  return profileBgChoicesFor({ steamId: user.steamId, unlocks });
}
