import { effectiveRole, roleLabel, type AppRole } from "@/lib/admin";
import { CLAN_ROLE_LABEL, type ClanRole } from "@/lib/clan";
import { formatRuDate, isActiveReserve } from "@/lib/validation";
import { normalizeProfileBg, profileBgChoicesFor } from "@/lib/profileBg";
import {
  profileBgChoicesForUser,
  profileNickStyleChoicesForUser,
  profilePatchChoicesForUser,
} from "@/lib/profileBgUnlocks";
import { normalizeProfilePatch } from "@/lib/profilePatches";
import { normalizeProfileNickStyle } from "@/lib/profileNickStyles";
import {
  buildPlayerMedalInventory,
  resolveMedalShelfSlots,
} from "@/lib/profileMedals";

type ClanRow = {
  role: string;
  title: { name: string } | null;
  clan: {
    id: string;
    name: string;
    tag: string;
    logoUrl: string | null;
  };
};

type InviteRow = {
  id: string;
  clan: { id: string; name: string; tag: string; logoUrl: string | null };
  inviter: { nick: string | null };
};

/** Пользователь, уже прочитанный со страницы или из /api/profile/shell. */
export type ProfileShellUser = {
  id: string;
  nick: string | null;
  avatarUrl: string | null;
  steamAvatar: string | null;
  profileBg: string | null;
  nickPatch: string | null;
  nickStyle: string | null;
  medalShelfIds: unknown;
  unlockedProfileBgs: unknown;
  unlockedNickPatches: unknown;
  unlockedNickStyles: unknown;
  lastSeenAt: Date | string | null;
  steamId: string;
  discordTag: string | null;
  discordId: string | null;
  telegram: string | null;
  steamName: string | null;
  role: string;
  regNo: number | null;
  reserveUntil: Date | string | null;
  reserveReason: string | null;
  dayOffUntil: Date | string | null;
  dayOffReason: string | null;
  clanMemberships: ClanRow[];
  clanInvites?: InviteRow[];
};

function asDate(value: Date | string | null): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Шапка профиля из уже найденного пользователя. Без второго поиска по нику. */
export async function buildProfileShell(
  me: ProfileShellUser,
  opts: {
    isSelf: boolean;
    avatarUrl?: string | null;
    steamAvatar?: string | null;
  }
) {
  const isSelf = opts.isSelf;
  const siteRoleKey = effectiveRole(me.steamId, me.role as AppRole);
  const admin =
    isSelf &&
    (siteRoleKey === "ADMIN" ||
      siteRoleKey === "HR" ||
      siteRoleKey === "DEPUTY" ||
      siteRoleKey === "SUPER_ADMIN");

  const isBb = me.clanMemberships.some((m) => {
    const t = String(m.clan.tag || "").trim().toLowerCase();
    const n = String(m.clan.name || "").trim().toLowerCase();
    return (
      t === "bb" ||
      t === "blackberry" ||
      n === "bb" ||
      n.includes("blackberry")
    );
  });

  const medalInventory = me.nick
    ? await buildPlayerMedalInventory(me.nick).catch(() => [])
    : [];
  const medalShelfIds = Array.isArray(me.medalShelfIds)
    ? (me.medalShelfIds as string[])
    : [];
  const medalSlots = resolveMedalShelfSlots(medalInventory, medalShelfIds);
  const medals = medalSlots.filter((x): x is NonNullable<typeof x> => Boolean(x));

  const unlocks = Array.isArray(me.unlockedProfileBgs)
    ? (me.unlockedProfileBgs as string[])
    : [];
  const patchUnlocks = Array.isArray(me.unlockedNickPatches)
    ? (me.unlockedNickPatches as string[])
    : [];
  const nickStyleUnlocks = Array.isArray(me.unlockedNickStyles)
    ? (me.unlockedNickStyles as string[])
    : [];
  const profileBgChoices = isSelf
    ? await profileBgChoicesForUser({
        id: me.id,
        steamId: me.steamId,
        nick: me.nick,
        unlockedProfileBgs: unlocks,
      }).catch(() =>
        profileBgChoicesFor({
          steamId: me.steamId,
          unlocks,
        })
      )
    : [];
  const profilePatchChoices = isSelf
    ? await profilePatchChoicesForUser({
        id: me.id,
        steamId: me.steamId,
        nick: me.nick,
        unlockedNickPatches: patchUnlocks,
      }).catch(() => [])
    : [];
  const profileNickStyleChoices = isSelf
    ? await profileNickStyleChoicesForUser({
        id: me.id,
        steamId: me.steamId,
        nick: me.nick,
        unlockedNickStyles: nickStyleUnlocks,
      }).catch(() => [])
    : [];

  const reserveUntil = asDate(me.reserveUntil);
  const dayOffUntil = asDate(me.dayOffUntil);

  return {
    id: me.id,
    nick: me.nick,
    avatarUrl: isSelf ? opts.avatarUrl || me.avatarUrl : me.avatarUrl,
    steamAvatar: isSelf ? opts.steamAvatar || me.steamAvatar : me.steamAvatar,
    profileBg: normalizeProfileBg(me.profileBg),
    profileBgChoices,
    nickPatch: normalizeProfilePatch(me.nickPatch),
    profilePatchChoices,
    nickStyle: normalizeProfileNickStyle(me.nickStyle),
    profileNickStyleChoices,
    medals,
    medalSlots,
    medalInventory: isSelf ? medalInventory : undefined,
    medalShelfIds: isSelf ? medalShelfIds : undefined,
    lastSeenAt: me.lastSeenAt,
    admin,
    isBb,
    kitsLane: isBb ? ("TR1" as const) : ("PB1" as const),
    discordTag: me.discordTag,
    discordId: me.discordId,
    telegram: me.telegram,
    steamId: me.steamId,
    steamName: me.steamName,
    siteRole: roleLabel(siteRoleKey),
    regNo: me.regNo,
    reserveActive: isActiveReserve(reserveUntil),
    reserveUntilLabel: reserveUntil ? formatRuDate(reserveUntil) : null,
    reserveReason: me.reserveReason,
    dayOffActive: isActiveReserve(dayOffUntil),
    dayOffUntilLabel: dayOffUntil ? formatRuDate(dayOffUntil) : null,
    dayOffReason: me.dayOffReason,
    invites: isSelf
      ? (me.clanInvites || []).map((inv) => ({
          id: inv.id,
          clan: inv.clan,
          inviter: inv.inviter,
        }))
      : [],
    clans: me.clanMemberships.map((m) => ({
      id: m.clan.id,
      tag: m.clan.tag,
      name: m.clan.name,
      logoUrl: m.clan.logoUrl,
      membershipLabel: [
        CLAN_ROLE_LABEL[m.role as ClanRole],
        m.title?.name || null,
      ]
        .filter(Boolean)
        .join(" · "),
    })),
  };
}
