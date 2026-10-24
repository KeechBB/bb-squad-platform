import { prisma } from "@/lib/prisma";
import {
  BP_L5_PROFILE_BG_ID,
  profileBgChoicesFor,
  profileBgUrl,
  type ProfileBgChoice,
} from "@/lib/profileBg";
import {
  BP_L15_PATCH_ID,
  PUBLIC_100_VEHICLES_PATCH_ID,
  profilePatchChoicesFor,
  profilePatchUrl,
  type ProfilePatchChoice,
} from "@/lib/profilePatches";
import { notifyRewardUnlock } from "@/lib/rewardNotice";
import {
  BP_L10_NICK_STYLE_ID,
  profileNickStyleChoicesFor,
  type ProfileNickStyleChoice,
} from "@/lib/profileNickStyles";
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
  await notifyRewardUnlock({
    userId: user.id,
    dedupeKey: `reward:bg:${BP_L5_PROFILE_BG_ID}`,
    title: "Турнирное золото II",
    body: "Новый фон профиля. Его можно поставить в кастомизации.",
    href: "/profile",
    linkLabel: "Открыть профиль",
    imageUrl: profileBgUrl(BP_L5_PROFILE_BG_ID),
  }).catch(() => undefined);
  return unlocks;
}

/** L10: металлический стиль ника в инвентарь навсегда. */
export async function ensureBpL10NickStyle(user: {
  id: string;
  nick: string | null;
  unlockedNickStyles: string[];
}): Promise<string[]> {
  const unlocks = [...(user.unlockedNickStyles || [])];
  if (unlocks.includes(BP_L10_NICK_STYLE_ID)) return unlocks;
  const nick = String(user.nick || "").trim();
  if (!nick) return unlocks;

  const state = await loadBattlePassState().catch(() => null);
  const prog = progressForNick(state, nick);
  if (prog.currentLevel < 10 && !prog.completedAt) return unlocks;

  unlocks.push(BP_L10_NICK_STYLE_ID);
  await prisma.user.update({
    where: { id: user.id },
    data: { unlockedNickStyles: unlocks },
  });
  await notifyRewardUnlock({
    userId: user.id,
    dedupeKey: `reward:font:${BP_L10_NICK_STYLE_ID}`,
    title: "Aurum Clean",
    body: "Новый золотой стиль ника в рейтингах. Ставится в кастомизации профиля.",
    href: "/profile",
    linkLabel: "Открыть профиль",
  }).catch(() => undefined);
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
  await notifyRewardUnlock({
    userId: user.id,
    dedupeKey: `reward:patch:${BP_L15_PATCH_ID}`,
    title: "M4A1 «Золотой стандарт»",
    body: "Новая нашивка. Её можно поставить у ника в рейтингах паблика, КВ и тренировок.",
    href: "/profile",
    linkLabel: "Открыть профиль",
    imageUrl: profilePatchUrl(BP_L15_PATCH_ID),
  }).catch(() => undefined);
  return unlocks;
}

/** Паблик: нашивка за 100 уничтоженных единиц техники остаётся в инвентаре навсегда. */
export async function ensurePublic100VehiclesNickPatch(user: {
  id: string;
  steamId: string;
  nick: string | null;
  unlockedNickPatches: string[];
}): Promise<string[]> {
  const unlocks = [...(user.unlockedNickPatches || [])];
  if (unlocks.includes(PUBLIC_100_VEHICLES_PATCH_ID)) return unlocks;

  const steamId = String(user.steamId || "").trim();
  const nickKey = String(user.nick || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  if (!steamId && !nickKey) return unlocks;

  const payload = await import("@/lib/publicRatingPageCache")
    .then(({ getPublicRatingPagePayload }) => getPublicRatingPagePayload())
    .catch(() => null);
  const row = payload?.board.rows.find((candidate) => {
    if (steamId && candidate.steamId === steamId) return true;
    return (
      nickKey &&
      String(candidate.nick || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "") === nickKey
    );
  });
  if (!row || Number(row.vehicleKills || 0) < 100) return unlocks;

  unlocks.push(PUBLIC_100_VEHICLES_PATCH_ID);
  await prisma.user.update({
    where: { id: user.id },
    data: { unlockedNickPatches: unlocks },
  });
  await notifyRewardUnlock({
    userId: user.id,
    dedupeKey: `reward:patch:${PUBLIC_100_VEHICLES_PATCH_ID}`,
    title: "Т-62 «Неоновый урожай»",
    body: "Новая нашивка за 100 уничтоженных единиц техники на паблике.",
    href: "/profile",
    linkLabel: "Открыть профиль",
    imageUrl: profilePatchUrl(PUBLIC_100_VEHICLES_PATCH_ID),
  }).catch(() => undefined);
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
  let unlocks = await ensureBpL15NickPatch(user);
  unlocks = await ensurePublic100VehiclesNickPatch({
    ...user,
    unlockedNickPatches: unlocks,
  });
  return profilePatchChoicesFor({ steamId: user.steamId, unlocks });
}

export async function profileNickStyleChoicesForUser(user: {
  id: string;
  steamId?: string;
  nick: string | null;
  unlockedNickStyles: string[];
}): Promise<ProfileNickStyleChoice[]> {
  const unlocks = await ensureBpL10NickStyle(user);
  return profileNickStyleChoicesFor({ unlocks, steamId: user.steamId });
}
