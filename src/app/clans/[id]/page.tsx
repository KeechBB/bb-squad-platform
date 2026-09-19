import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import {
  assignableClanRoles,
  canManageClanMembers,
  type ClanRole,
} from "@/lib/clan";
import { ClanDetailClient } from "@/components/ClanDetailClient";
import { ensureDefaultSquads } from "@/lib/squads";
import { canManageClanTitles, ensureDefaultTitles } from "@/lib/titles";

type Props = { params: Promise<{ id: string }> };

export default async function ClanPage({ params }: Props) {
  const { id } = await params;
  const session = await getSession();

  await ensureDefaultSquads(id);
  await ensureDefaultTitles(id);

  const clan = await prisma.clan.findUnique({
    where: { id },
    include: {
      members: {
        include: {
          user: {
            select: {
              id: true,
              nick: true,
              name: true,
              avatarUrl: true,
              steamName: true,
              reserveUntil: true,
              reserveReason: true,
              updatedAt: true,
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

  let myRole: ClanRole | null = null;
  let myUserId: string | null = null;
  let myTitleName: string | null = null;
  if (session?.user?.steamId) {
    const me = await prisma.user.findUnique({
      where: { steamId: session.user.steamId },
    });
    if (me) {
      myUserId = me.id;
      const membership = clan.members.find((m) => m.userId === me.id);
      myRole = (membership?.role as ClanRole) || null;
      myTitleName = membership?.title?.name || null;
    }
  }

  const canManage = myRole ? canManageClanMembers(myRole) : false;
  const assignable = myRole ? assignableClanRoles(myRole) : [];
  const canTitles =
    myRole != null ? canManageClanTitles(myRole, myTitleName) : false;

  return (
    <main className="clan-page">
      <ClanDetailClient
        clan={{
          id: clan.id,
          name: clan.name,
          tag: clan.tag,
          logoUrl: clan.logoUrl,
        }}
        members={clan.members.map((m) => ({
          id: m.id,
          role: m.role as ClanRole,
          joinedAt: m.joinedAt.toISOString(),
          title: m.title ? { id: m.title.id, name: m.title.name } : null,
          user: {
            ...m.user,
            reserveUntil: m.user.reserveUntil?.toISOString() ?? null,
            reserveReason: m.user.reserveReason,
            updatedAt: m.user.updatedAt.toISOString(),
          },
        }))}
        titles={clan.titles}
        myUserId={myUserId}
        myRole={myRole}
        myTitleName={myTitleName}
        canManage={canManage}
        canManageTitles={canTitles}
        assignableRoles={assignable}
      />
    </main>
  );
}
