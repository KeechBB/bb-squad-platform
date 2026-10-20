import { prisma } from "@/lib/prisma";
import {
  BP_L5_PROFILE_BG_ID,
  profileBgChoicesFor,
  type ProfileBgChoice,
} from "@/lib/profileBg";
import {
  BP_L15_PATCH_ID,
  profilePatchChoicesFor,
  type ProfilePatchChoice,
} from "@/lib/profilePatches";
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

/** L15: кастомизация — нашивка в инвентарь навсегда. */
export async function ensureBpL15NickPatch(user: {
  id: string;
  nick: string | null;
  unlockedNickPatches: string[];
}): Promise<string[]> {
  const unlocks = [...(user.unlockedNickPatches || [])];
  if (
    unlocks.includes(BP_L15_PATCH_ID) ||
    unlocks.includes("pb1-profile-customize") ||
    unlocks.includes("pb1-gold-nick")
  ) {
    if (!unlocks.includes(BP_L15_PATCH_ID)) {
      unlocks.push(BP_L15_PATCH_ID);
      await prisma.user.update({
        where: { id: user.id },
        data: { unlockedNickPatches: unlocks },
      });
    }
    return unlocks;
  }
  const nick = String(user.nick || "").trim();
  if (!nick) return unlocks;

  const state = await loadBattlePassState().catch(() => null);
  const prog = progressForNick(state, nick);
  if (prog.currentLevel < 15 && !prog.completedAt) return unlocks;

  unlocks.push(BP_L15_PATCH_ID);
  unlocks.push("pb1-profile-customize");
  await prisma.user.update({
    where: { id: user.id },
    data: { unlockedNickPatches: unlocks },
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

export async function profilePatchChoicesForUser(user: {
  id: string;
  steamId: string;
  nick: string | null;
  unlockedNickPatches: string[];
}): Promise<ProfilePatchChoice[]> {
  const unlocks = await ensureBpL15NickPatch(user);
  return profilePatchChoicesFor({ steamId: user.steamId, unlocks });
}
