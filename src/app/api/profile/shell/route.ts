import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatRuDate, isActiveReserve } from "@/lib/validation";
import { effectiveRole, roleLabel, type AppRole } from "@/lib/admin";
import { CLAN_ROLE_LABEL, type ClanRole } from "@/lib/clan";
import { normalizeProfileBg, profileBgChoicesFor } from "@/lib/profileBg";
import {
  profileBgChoicesForUser,
  profilePatchChoicesForUser,
} from "@/lib/profileBgUnlocks";
import { normalizeProfilePatch } from "@/lib/profilePatches";
import { buildPlayerMedalShelf } from "@/lib/profileMedals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Лёгкий shell профиля — без combat/RP корпусов. */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ error: "auth" }, { status: 401 });
  }

  const nickQ = new URL(req.url).searchParams.get("nick")?.trim() || "";
  const include = {
    clanMemberships: {
      include: {
        clan: { select: { id: true, name: true, tag: true, logoUrl: true } },
        title: { select: { name: true } },
      },
    },
    clanInvites: {
      where: { status: "PENDING" as const },
      include: {
        clan: { select: { id: true, name: true, tag: true, logoUrl: true } },
        inviter: { select: { nick: true } },
      },
      orderBy: { createdAt: "desc" as const },
    },
  };

  const me = nickQ
    ? await prisma.user.findFirst({
        where: {
          nick: { equals: nickQ, mode: "insensitive" },
          profileComplete: true,
        },
        include,
      })
    : await prisma.user.findUnique({
        where: { steamId: session.user.steamId },
        include,
      });
  if (!me) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const isSelf = me.steamId === session.user.steamId;

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

  const medals = me.nick
    ? await buildPlayerMedalShelf(me.nick).catch(() => [])
    : [];

  const unlocks = Array.isArray(me.unlockedProfileBgs)
    ? me.unlockedProfileBgs
    : [];
  const patchUnlocks = Array.isArray(me.unlockedNickPatches)
    ? me.unlockedNickPatches
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

  return NextResponse.json(
    {
      id: me.id,
      nick: me.nick,
      name: me.name,
      avatarUrl: isSelf
        ? session.user.avatarUrl || me.avatarUrl
        : me.avatarUrl,
      steamAvatar: isSelf
        ? session.user.steamAvatar || me.steamAvatar
        : me.steamAvatar,
      profileBg: normalizeProfileBg(me.profileBg),
      profileBgChoices,
      nickPatch: normalizeProfilePatch(me.nickPatch),
      profilePatchChoices,
      medals,
      lastSeenAt: me.lastSeenAt,
      admin,
      isBb,
      kitsLane: isBb ? "TR1" : "PB1",
      birthDate: me.birthDate ? formatRuDate(me.birthDate) : null,
      age: me.age,
      discordTag: me.discordTag,
      discordId: me.discordId,
      telegram: me.telegram,
      steamId: me.steamId,
      steamName: me.steamName,
      siteRole: roleLabel(siteRoleKey),
      regNo: me.regNo,
      reserveActive: isActiveReserve(me.reserveUntil),
      reserveUntilLabel: me.reserveUntil
        ? formatRuDate(me.reserveUntil)
        : null,
      reserveReason: me.reserveReason,
      dayOffActive: isActiveReserve(me.dayOffUntil),
      dayOffUntilLabel: me.dayOffUntil
        ? formatRuDate(me.dayOffUntil)
        : null,
      dayOffReason: me.dayOffReason,
      invites: isSelf
        ? me.clanInvites.map((inv) => ({
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
    },
    {
      headers: {
        "Cache-Control": "private, max-age=60, stale-while-revalidate=120",
      },
    }
  );
}
