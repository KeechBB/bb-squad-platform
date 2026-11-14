import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildProfileShell, type ProfileShellUser } from "@/lib/profileShell";

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let me: any = null;
  if (nickQ) {
    const { collisionBySiteNick, resolveProfileAccountNick } = await import(
      "@/lib/nickCollisions"
    );
    const collision = collisionBySiteNick(nickQ);
    const accountNick = resolveProfileAccountNick(nickQ);
    me =
      (collision?.steamId
        ? await prisma.user.findFirst({
            where: {
              steamId: collision.steamId,
              profileComplete: true,
            },
            include,
          })
        : null) ||
      (await prisma.user.findFirst({
        where: {
          nick: accountNick,
          profileComplete: true,
        },
        include,
      })) ||
      (await prisma.user.findFirst({
        where: {
          nick: { equals: accountNick, mode: "insensitive" },
          profileComplete: true,
        },
        include,
      }));
  } else {
    me = await prisma.user.findUnique({
      where: { steamId: session.user.steamId },
      include,
    });
  }
  if (!me) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const isSelf = me.steamId === session.user.steamId;
  const shell = await buildProfileShell(me as ProfileShellUser, {
    isSelf,
    avatarUrl: session.user.avatarUrl,
    steamAvatar: session.user.steamAvatar,
  });

  return NextResponse.json(
    shell,
    {
      headers: {
        "Cache-Control": "private, max-age=60, stale-while-revalidate=120",
      },
    }
  );
}
