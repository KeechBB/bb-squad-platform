import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatRuDate, isActiveReserve } from "@/lib/validation";
import { effectiveRole, roleLabel, type AppRole } from "@/lib/admin";
import { CLAN_ROLE_LABEL, type ClanRole } from "@/lib/clan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Лёгкий shell профиля — без combat/RP корпусов. */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ error: "auth" }, { status: 401 });
  }

  const me = await prisma.user.findUnique({
    where: { steamId: session.user.steamId },
    include: {
      clanMemberships: {
        include: {
          clan: { select: { id: true, name: true, tag: true, logoUrl: true } },
          title: { select: { name: true } },
        },
      },
      clanInvites: {
        where: { status: "PENDING" },
        include: {
          clan: { select: { id: true, name: true, tag: true, logoUrl: true } },
          inviter: { select: { nick: true } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!me) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const siteRoleKey = effectiveRole(me.steamId, me.role as AppRole);
  const admin =
    siteRoleKey === "ADMIN" ||
    siteRoleKey === "HR" ||
    siteRoleKey === "DEPUTY" ||
    siteRoleKey === "SUPER_ADMIN";

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

  return NextResponse.json(
    {
      id: me.id,
      nick: me.nick,
      name: me.name,
      avatarUrl: session.user.avatarUrl || me.avatarUrl,
      steamAvatar: session.user.steamAvatar || me.steamAvatar,
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
      invites: me.clanInvites.map((inv) => ({
        id: inv.id,
        clan: inv.clan,
        inviter: inv.inviter,
      })),
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
