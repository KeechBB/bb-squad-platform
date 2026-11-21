import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound, redirect } from "next/navigation";
import {
  assignableClanRoles,
  canDeleteClan,
  canEditOwnClanIdentity,
  canManageClanMembers,
  type ClanRole,
} from "@/lib/clan";
import {
  canGrantClanVip,
  clanAllowsVipGrants,
  isPlatformClanOwner,
} from "@/lib/clanActor";
import { canEditAnyClanIdentity, getUserRole, isBuiltinSuperAdmin } from "@/lib/admin";
import { normalizeClanTag } from "@/lib/clanMapColor";
import { ClanDetailClient } from "@/components/ClanDetailClient";
import { ensureDefaultSquads } from "@/lib/squads";
import {
  canManageClanTitles,
  canReviewClanJoinRequests,
  ensureDefaultTitles,
} from "@/lib/titles";
import { listPendingForClan } from "@/lib/opponentClan";
import { GuestSteamGate } from "@/components/GuestSteamGate";

type Props = { params: Promise<{ id: string }> };

const HOLDER_NICK = "BB-ClanHolder";
const EXTERNAL_LEADER_STEAM_PREFIX = "7656119900001";

export default async function ClanPage({ params }: Props) {
  const { id } = await params;
  const session = await getSession();
  if (!session?.user?.steamId) {
    return (
      <GuestSteamGate
        title="Клан"
        message="Авторизуйтесь через Steam, чтобы открыть карточку клана."
      />
    );
  }
  if (!session.user.profileComplete) {
    redirect("/register");
  }

  await ensureDefaultSquads(id);
  await ensureDefaultTitles(id);

  const clan = await prisma.clan.findUnique({
    where: { id },
    include: {
      leader: { select: { nick: true, steamId: true } },
      members: {
        include: {
          user: {
            select: {
              id: true,
              nick: true,
              name: true,
              avatarUrl: true,
              steamName: true,
              steamId: true,
              reserveUntil: true,
              reserveReason: true,
              updatedAt: true,
              lastSeenAt: true,
            },
          },
          title: { select: { id: true, name: true } },
        },
      },
      titles: {
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: { id: true, name: true, sortOrder: true },
      },
    },
  });
  if (!clan) notFound();

  const pendingMembers = clan.isExternal
    ? await listPendingForClan(clan.id)
    : [];
  const clanTagNorm = normalizeClanTag(clan.tag);
  const isBbClan = clanTagNorm === "BB";
  const visibleMembers = (clan.isExternal
    ? clan.members.filter((m) => {
        const nick = (m.user.nick || "").trim();
        const steam = m.user.steamId || "";
        if (nick === HOLDER_NICK || (m.user.steamName || "").trim() === HOLDER_NICK)
          return false;
        // фиктивные «главы» external-кланов не показываем в составе
        if (steam.startsWith(EXTERNAL_LEADER_STEAM_PREFIX)) return false;
        return true;
      })
    : clan.members
  ).filter((m) => {
    // владелец платформы числится только в [BB]
    if (!isBbClan && isPlatformClanOwner(m.user.steamId)) return false;
    return true;
  });

  const realLeaderMember = clan.isExternal
    ? visibleMembers.find((m) => m.role === "LEADER") ||
      visibleMembers.find((m) =>
        Boolean(
          clan.leader?.nick &&
            (m.user.nick || "")
              .toLowerCase()
              .includes(String(clan.leader.nick).toLowerCase())
        )
      )
    : null;
  const externalLeaderNick = clan.isExternal
    ? realLeaderMember?.user.nick ||
      (clan.leader?.nick &&
      clan.leader.nick !== HOLDER_NICK &&
      !clan.leader.steamId?.startsWith(EXTERNAL_LEADER_STEAM_PREFIX)
        ? clan.leader.nick
        : null)
    : null;

  let myRole: ClanRole | null = null;
  let myUserId: string | null = null;
  let myTitleName: string | null = null;
  let platformOwnerAccess = false;
  let inOtherClan = false;
  let myPendingRequestId: string | null = null;
  let joinRequests: Array<{
    id: string;
    createdAt: string;
    user: {
      id: string;
      nick: string | null;
      name: string | null;
      avatarUrl: string | null;
      steamName: string | null;
      steamId?: string | null;
    };
  }> = [];

  if (session?.user?.steamId) {
    const me = await prisma.user.findUnique({
      where: { steamId: session.user.steamId },
    });
    if (me) {
      myUserId = me.id;
      const membership = clan.members.find((m) => m.userId === me.id);
      myRole = (membership?.role as ClanRole) || null;
      myTitleName = membership?.title?.name || null;
      platformOwnerAccess =
        isPlatformClanOwner(session.user.steamId) && !membership;

      if (!membership) {
        const other = await prisma.clanMember.findFirst({
          where: { userId: me.id },
          select: { id: true },
        });
        inOtherClan = Boolean(other);

        const pending = await prisma.clanJoinRequest.findFirst({
          where: { clanId: id, userId: me.id, status: "PENDING" },
          select: { id: true },
        });
        myPendingRequestId = pending?.id ?? null;
      }

      const effectiveRole: ClanRole | null = myRole || (platformOwnerAccess ? "LEADER" : null);
      if (
        effectiveRole &&
        canReviewClanJoinRequests(effectiveRole, myTitleName)
      ) {
        const pending = await prisma.clanJoinRequest.findMany({
          where: { clanId: id, status: "PENDING" },
          orderBy: { createdAt: "asc" },
          include: {
            user: {
              select: {
                id: true,
                nick: true,
                name: true,
                avatarUrl: true,
                steamName: true,
                steamId: true,
              },
            },
          },
        });
        joinRequests = pending.map((r) => ({
          id: r.id,
          createdAt: r.createdAt.toISOString(),
          user: r.user,
        }));
      }
    }
  }

  const effectiveRole: ClanRole | null =
    myRole || (platformOwnerAccess ? "LEADER" : null);
  const canManage = effectiveRole ? canManageClanMembers(effectiveRole) : false;
  const assignable = effectiveRole
    ? assignableClanRoles(effectiveRole, myTitleName)
    : [];
  const canTitles =
    effectiveRole != null
      ? canManageClanTitles(effectiveRole, myTitleName)
      : false;
  const canReviewJoins =
    effectiveRole != null
      ? canReviewClanJoinRequests(effectiveRole, myTitleName)
      : false;
  // external-кланы не распускаем с сайта; заявки — через приглашение главы
  const canDisband =
    effectiveRole && !clan.isExternal ? canDeleteClan(effectiveRole) : false;
  const canApply =
    Boolean(session?.user?.steamId) &&
    Boolean(session?.user?.profileComplete) &&
    myRole == null &&
    !platformOwnerAccess &&
    !inOtherClan &&
    !clan.isExternal;
  const showVipCol =
    clanAllowsVipGrants(clan.tag) && canGrantClanVip(effectiveRole);

  const vipSteamIds = new Set<string>();
  if (showVipCol) {
    const steams = visibleMembers
      .map((m) => m.user.steamId)
      .filter((s): s is string => Boolean(s));
    if (steams.length) {
      const grants = await prisma.panelkaVipGrant.findMany({
        where: { steamId: { in: steams }, active: true },
        select: { steamId: true },
      });
      for (const g of grants) vipSteamIds.add(g.steamId);
    }
  }

  const appRole = session?.user?.steamId
    ? await getUserRole(session.user.steamId)
    : null;
  const canEditClanProfile =
    canEditAnyClanIdentity(appRole) ||
    canEditOwnClanIdentity(effectiveRole) ||
    platformOwnerAccess;

  const showFactions =
    Boolean(session?.user?.steamId) &&
    isBuiltinSuperAdmin(session?.user?.steamId) &&
    !clan.isExternal &&
    isBbClan;

  const { mainKitByUserIds } = await import("@/lib/squadRoles");
  const mainKits = await mainKitByUserIds(
    visibleMembers.map((m) => m.userId)
  ).catch(() => new Map<string, string>());

  return (
    <main className="clan-page">
      <ClanDetailClient
        clan={{
          id: clan.id,
          name: clan.name,
          tag: clan.tag,
          logoUrl: clan.logoUrl,
          isExternal: clan.isExternal,
          leaderNick: externalLeaderNick,
        }}
        members={visibleMembers.map((m) => ({
          id: m.id,
          role: m.role as ClanRole,
          joinedAt: m.joinedAt.toISOString(),
          title: m.title ? { id: m.title.id, name: m.title.name } : null,
          mainKit: mainKits.get(m.userId) || "—",
          hasVip: m.user.steamId ? vipSteamIds.has(m.user.steamId) : false,
          user: {
            ...m.user,
            reserveUntil: m.user.reserveUntil?.toISOString() ?? null,
            reserveReason: m.user.reserveReason,
            updatedAt: m.user.updatedAt.toISOString(),
            lastSeenAt: m.user.lastSeenAt?.toISOString() ?? null,
          },
        }))}
        pendingMembers={pendingMembers.map((p) => ({
          nick: p.nick,
          steamId: p.steamId,
          matchId: p.matchId,
        }))}
        titles={clan.titles}
        myUserId={myUserId}
        myRole={effectiveRole}
        myTitleName={myTitleName}
        platformOwnerAccess={platformOwnerAccess}
        canManage={canManage}
        canManageTitles={canTitles}
        canReviewJoins={canReviewJoins}
        canDisband={canDisband}
        canEditClanProfile={canEditClanProfile}
        canApply={canApply}
        inOtherClan={inOtherClan}
        isLoggedIn={Boolean(session?.user?.steamId)}
        profileComplete={Boolean(session?.user?.profileComplete)}
        myPendingRequestId={myPendingRequestId}
        joinRequests={joinRequests}
        assignableRoles={assignable}
        showFactions={showFactions}
        showVipCol={showVipCol}
      />
    </main>
  );
}
