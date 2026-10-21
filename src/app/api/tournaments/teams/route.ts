import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TOURNAMENT_TEAM_ROSTER_MAX } from "@/lib/tournaments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const teamInclude = {
  members: {
    include: {
      user: {
        select: {
          id: true,
          nick: true,
          steamId: true,
          clanMemberships: {
            take: 1,
            include: { clan: { select: { tag: true, name: true } } },
          },
        },
      },
    },
    orderBy: { joinedAt: "asc" as const },
  },
  invites: {
    where: { status: "PENDING" as const },
    include: { user: { select: { nick: true } } },
    orderBy: { createdAt: "desc" as const },
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapTeam(team: any) {
  return {
    id: team.id as string,
    name: team.name as string,
    tag: team.tag as string,
    logoUrl: (team.logoUrl as string | null) ?? null,
    createdAt: new Date(team.createdAt).toISOString(),
    membersCount: team.members.length as number,
    rosterMax: TOURNAMENT_TEAM_ROSTER_MAX,
    members: team.members.map(
      (m: {
        id: string;
        role: string;
        joinedAt: Date;
        user: {
          id: string;
          nick: string | null;
          steamId: string;
          clanMemberships: { clan: { tag: string; name: string } }[];
        };
      }) => ({
        id: m.id,
        userId: m.user.id,
        nick: m.user.nick || m.user.steamId,
        steamId: m.user.steamId,
        joinedAt: new Date(m.joinedAt).toISOString(),
        role: m.role,
        clanTag: m.user.clanMemberships[0]?.clan.tag || null,
        clanName: m.user.clanMemberships[0]?.clan.name || null,
      })
    ),
    pendingInvites: team.invites.map(
      (i: { id: string; createdAt: Date; user: { nick: string | null } }) => ({
        id: i.id,
        nick: i.user.nick || "?",
        sentAt: new Date(i.createdAt).toISOString(),
      })
    ),
  };
}

/** GET — список команд (публично) + моя команда (если залогинен) */
export async function GET() {
  const session = await getServerSession(authOptions);
  const teams = await prisma.tournamentTeam.findMany({
    orderBy: { createdAt: "desc" },
    include: teamInclude,
  });

  let myTeamId: string | null = null;
  let myRole: string | null = null;
  let myUserId: string | null = null;
  let canCreate = false;

  if (session?.user?.steamId && session.user.profileComplete) {
    const me = await prisma.user.findUnique({
      where: { steamId: session.user.steamId },
      select: { id: true },
    });
    if (me) {
      myUserId = me.id;
      const membership = await prisma.tournamentTeamMember.findFirst({
        where: { userId: me.id },
        select: { teamId: true, role: true },
      });
      myTeamId = membership?.teamId || null;
      myRole = membership?.role || null;
      canCreate = !myTeamId;
    }
  }

  return NextResponse.json({
    ok: true,
    teams: teams.map(mapTeam),
    myTeamId,
    myRole,
    myUserId,
    canCreate,
    authed: Boolean(session?.user?.steamId && session.user.profileComplete),
  });
}

/** POST — создать команду (JSON или FormData с logo) */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const me = await prisma.user.findUnique({
    where: { steamId: session.user.steamId },
    select: { id: true },
  });
  if (!me) return NextResponse.json({ error: "no user" }, { status: 401 });

  const existing = await prisma.tournamentTeamMember.findFirst({
    where: { userId: me.id },
  });
  if (existing) {
    return NextResponse.json(
      { error: "Ты уже в команде" },
      { status: 409 }
    );
  }

  const ct = req.headers.get("content-type") || "";
  let name = "";
  let tag = "";
  let logoBlob: Blob | null = null;

  if (ct.includes("multipart/form-data")) {
    const form = await req.formData();
    name = String(form.get("name") || "").trim();
    tag = String(form.get("tag") || "")
      .trim()
      .toUpperCase();
    const logo = form.get("logo");
    if (logo && typeof logo !== "string" && "arrayBuffer" in logo) {
      logoBlob = logo as Blob;
    }
  } else {
    const body = (await req.json().catch(() => ({}))) as {
      name?: string;
      tag?: string;
    };
    name = String(body.name || "").trim();
    tag = String(body.tag || "")
      .trim()
      .toUpperCase();
  }

  if (name.length < 2 || name.length > 32) {
    return NextResponse.json({ error: "Название 2–32 символа" }, { status: 400 });
  }
  if (!/^[A-Za-zА-Яа-яЁё0-9 _.\-]{2,32}$/.test(name)) {
    return NextResponse.json({ error: "Недопустимое название" }, { status: 400 });
  }
  if (!/^[A-Za-zА-Яа-яЁё0-9]{2,6}$/.test(tag)) {
    return NextResponse.json({ error: "Тег: 2–6 букв/цифр" }, { status: 400 });
  }

  const taken = await prisma.tournamentTeam.findUnique({ where: { tag } });
  if (taken) {
    return NextResponse.json({ error: "Тег занят" }, { status: 409 });
  }

  const {
    TEAM_LOGO_MAX,
    detectClanLogoMime,
    saveTeamLogo,
    deleteTeamLogo,
  } = await import("@/lib/tournamentTeamLogoFile");

  let logoBuf: Buffer | null = null;
  let logoMime: ReturnType<typeof detectClanLogoMime> = null;
  if (logoBlob && logoBlob.size > 0) {
    if (logoBlob.size > TEAM_LOGO_MAX) {
      return NextResponse.json({ error: "Лого до 5 МБ (png/webp)" }, { status: 400 });
    }
    logoBuf = Buffer.from(await logoBlob.arrayBuffer());
    logoMime = detectClanLogoMime(logoBuf);
    if (!logoMime) {
      return NextResponse.json(
        { error: "Лого: только png или webp" },
        { status: 400 }
      );
    }
  }

  const team = await prisma.tournamentTeam.create({
    data: {
      name,
      tag,
      members: {
        create: {
          userId: me.id,
          role: "CAPTAIN",
        },
      },
    },
    include: teamInclude,
  });

  if (logoBuf && logoMime) {
    try {
      const logoUrl = await saveTeamLogo(team.id, logoBuf, logoMime);
      await prisma.tournamentTeam.update({
        where: { id: team.id },
        data: { logoUrl },
      });
      team.logoUrl = logoUrl;
    } catch {
      await deleteTeamLogo(team.id).catch(() => undefined);
    }
  }

  return NextResponse.json({ ok: true, team: mapTeam(team) });
}
