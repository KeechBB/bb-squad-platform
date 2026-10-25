import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  TOURNAMENT_TEAM_ROSTER_MAX,
  ACTIVE_TOURNAMENT,
  normalizeTeamTag,
  teamIdentityError,
} from "@/lib/tournaments";
import { personLabel, writeActionLog } from "@/lib/actionLog";

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
  votes: {
    select: { userId: true, value: true },
  },
};

type MapTeamMember = {
  id: string;
  role: string;
  joinedAt: Date;
  user: {
    id: string;
    nick: string | null;
    steamId: string;
    clanMemberships: { clan: { tag: string; name: string } }[];
  };
};

type MapTeamInvite = {
  id: string;
  createdAt: Date;
  user: { nick: string | null };
};

type MapTeamInput = {
  id: string;
  name: string;
  tag: string;
  logoUrl: string | null;
  createdAt: Date;
  members: MapTeamMember[];
  invites: MapTeamInvite[];
  votes?: { userId: string; value: number }[];
};

function mapTeam(
  team: MapTeamInput,
  opts?: { includeInvites?: boolean; viewerUserId?: string | null }
) {
  const votes = team.votes || [];
  let likes = 0;
  let dislikes = 0;
  let myVote: 1 | -1 | null = null;
  for (const v of votes) {
    if (v.value === 1) likes += 1;
    else if (v.value === -1) dislikes += 1;
    if (opts?.viewerUserId && v.userId === opts.viewerUserId) {
      myVote = v.value === 1 || v.value === -1 ? (v.value as 1 | -1) : null;
    }
  }
  return {
    id: team.id,
    name: team.name,
    tag: team.tag,
    logoUrl: team.logoUrl ?? null,
    createdAt: new Date(team.createdAt).toISOString(),
    membersCount: team.members.length,
    rosterMax: TOURNAMENT_TEAM_ROSTER_MAX,
    likes,
    dislikes,
    myVote,
    members: team.members.map((m) => ({
      id: m.id,
      userId: m.user.id,
      nick: m.user.nick || m.user.steamId,
      steamId: m.user.steamId,
      joinedAt: new Date(m.joinedAt).toISOString(),
      role: m.role,
      /** Турнирные матчи ещё не оцифрованы — всегда 0. */
      matchesPlayed: 0,
      clanTag: m.user.clanMemberships[0]?.clan.tag || null,
      clanName: m.user.clanMemberships[0]?.clan.name || null,
    })),
    pendingInvites: opts?.includeInvites
      ? team.invites.map((i) => ({
          id: i.id,
          nick: i.user.nick || "?",
          sentAt: new Date(i.createdAt).toISOString(),
        }))
      : [],
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
    teams: teams.map((t) =>
      mapTeam(t, {
        includeInvites: Boolean(myTeamId && t.id === myTeamId),
        viewerUserId: myUserId,
      })
    ),
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
    select: { id: true, nick: true, name: true, steamName: true, steamId: true },
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
    tag = normalizeTeamTag(String(form.get("tag") || ""));
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
    tag = normalizeTeamTag(String(body.tag || ""));
  }

  const identityError = teamIdentityError(name, tag);
  if (identityError) {
    return NextResponse.json({ error: identityError }, { status: 400 });
  }
  name = name.trim();

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
      return NextResponse.json(
        { error: "Лого до 20 МБ (png/webp/jpeg)" },
        { status: 400 }
      );
    }
    logoBuf = Buffer.from(await logoBlob.arrayBuffer());
    logoMime = detectClanLogoMime(logoBuf);
    if (!logoMime) {
      return NextResponse.json(
        {
          error:
            "Лого не распознано. Нужен настоящий png, webp или jpeg (не переименованный файл)",
        },
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

  const nick = personLabel(me);
  await writeActionLog({
    category: "tournament",
    action: "team_create",
    message: `${nick} создал команду [${tag}] ${name}`,
    actorId: me.id,
    actorNick: nick,
    clanId: team.id,
    clanTag: tag,
    meta: {
      tournamentId: ACTIVE_TOURNAMENT.id,
      tournamentName: ACTIVE_TOURNAMENT.name,
      teamId: team.id,
      teamName: name,
      hasLogo: Boolean(team.logoUrl),
    },
  });

  return NextResponse.json({ ok: true, team: mapTeam(team) });
}
