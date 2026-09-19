import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import {
  assignableClanRoles,
  canManageClanMembers,
  type ClanRole,
} from "@/lib/clan";
import { ClanDetailClient } from "@/components/ClanDetailClient";

type Props = { params: Promise<{ id: string }> };

export default async function ClanPage({ params }: Props) {
  const { id } = await params;
  const session = await getSession();

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
            },
          },
        },
      },
    },
  });
  if (!clan) notFound();

  let myRole: ClanRole | null = null;
  if (session?.user?.steamId) {
    const me = await prisma.user.findUnique({
      where: { steamId: session.user.steamId },
    });
    if (me) {
      const membership = clan.members.find((m) => m.userId === me.id);
      myRole = (membership?.role as ClanRole) || null;
    }
  }

  const canManage = myRole ? canManageClanMembers(myRole) : false;
  const assignable = myRole ? assignableClanRoles(myRole) : [];

  return (
    <main>
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
          user: m.user,
        }))}
        myRole={myRole}
        canManage={canManage}
        assignableRoles={assignable}
      />
    </main>
  );
}
