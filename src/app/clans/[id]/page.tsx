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
import { canEditAnyClanIdentity, getUserRole } from "@/lib/admin";
import { ClanDetailClient } from "@/components/ClanDetailClient";
import { ensureDefaultSquads } from "@/lib/squads";
import {
  canManageClanTitles,
  canReviewClanJoinRequests,
  ensureDefaultTitles,
} from "@/lib/titles";
import { loadTierIndex } from "@/lib/loadTierIndex";
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
  const visibleMembers = clan.isExternal
    ? clan.members.filter((m) => {
        const nick = (m.user.nick || "").trim();
        const steam = m.user.steamId || "";
        if (nick === HOLDER_NICK || (m.user.steamName || "").trim() === HOLDER_NICK)
          return false;
        // фиктивные «главы» external-кланов не показываем в составе
        if (steam.startsWith(EXTERNAL_LEADER_STEAM_PREFIX)) return false;
        return true;
      })
    : clan.members;

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
    };
  }> = [];

  if (session?.user?.steamId) {
    const me = await prisma.user.findUnique({
      where: { steamId: session.user.steamId },
    });
    if (me) {
      myUserId = me.id;
      const membership = visibleMembers.find((m) => m.userId === me.id) ||
        clan.members.find((m) => m.userId === me.id);
      myRole = (membership?.role as ClanRole) || null;
      myTitleName = membership?.title?.name || null;

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
      } else if (
        canReviewClanJoinRequests(myRole as ClanRole, myTitleName)
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

  const canManage = myRole ? canManageClanMembers(myRole) : false;
  const assignable = myRole ? assignableClanRoles(myRole, myTitleName) : [];
  const canTitles =
    myRole != null ? canManageClanTitles(myRole, myTitleName) : false;
  const canReviewJoins =
    myRole != null
      ? canReviewClanJoinRequests(myRole, myTitleName)
      : false;
  // external-кланы не распускаем с сайта; заявки — через приглашение главы
  const canDisband =
    myRole && !clan.isExternal ? canDeleteClan(myRole) : false;
  const canApply =
    Boolean(session?.user?.steamId) &&
    Boolean(session?.user?.profileComplete) &&
    myRole == null &&
    !inOtherClan &&
    !clan.isExternal;

  const appRole = session?.user?.steamId
    ? await getUserRole(session.user.steamId)
    : null;
  const canEditClanProfile =
    canEditAnyClanIdentity(appRole) || canEditOwnClanIdentity(myRole);

  const tierMap = await loadTierIndex();
  const tierEntries = Array.from(tierMap.entries());

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
        myRole={myRole}
        myTitleName={myTitleName}
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
        tierEntries={tierEntries}
      />
    </main>
  );
}
