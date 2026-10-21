import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  ACTIVE_TOURNAMENT,
  TOURNAMENT_ENTRY_MAX,
  TOURNAMENT_ENTRY_STARTERS,
  TOURNAMENT_ENTRY_SUBS,
  canWithdrawEntry,
  isRegistrationOpen,
} from "@/lib/tournaments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TID = ACTIVE_TOURNAMENT.id;

/** GET — заявки турнира + статус моей команды */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const me = await prisma.user.findUnique({
    where: { steamId: session.user.steamId },
    select: { id: true },
  });
  if (!me) return NextResponse.json({ error: "no user" }, { status: 401 });

  const membership = await prisma.tournamentTeamMember.findFirst({
    where: { userId: me.id },
    include: {
      team: {
        include: {
          members: {
            include: {
              user: { select: { id: true, nick: true, steamId: true } },
            },
            orderBy: { joinedAt: "asc" },
          },
        },
      },
    },
  });

  const entries = await prisma.tournamentEntry.findMany({
    where: { tournamentId: TID, status: "CONFIRMED" },
    orderBy: { createdAt: "asc" },
    include: {
      team: { select: { id: true, name: true, tag: true, logoUrl: true } },
      players: {
        include: { user: { select: { nick: true, steamId: true } } },
        orderBy: [{ slot: "asc" }, { ord: "asc" }],
      },
    },
  });

  const myTeamId = membership?.teamId || null;
  const myEntry = myTeamId
    ? await prisma.tournamentEntry.findFirst({
        where: {
          tournamentId: TID,
          teamId: myTeamId,
          status: "CONFIRMED",
        },
        include: {
          players: {
            include: { user: { select: { id: true, nick: true } } },
            orderBy: [{ slot: "asc" }, { ord: "asc" }],
          },
        },
      })
    : null;

  const regOpen = isRegistrationOpen(ACTIVE_TOURNAMENT);
  const canWithdraw = canWithdrawEntry(ACTIVE_TOURNAMENT);

  return NextResponse.json({
    ok: true,
    tournamentId: TID,
    registrationOpen: regOpen,
    canWithdraw,
    limits: {
      starters: TOURNAMENT_ENTRY_STARTERS,
      subs: TOURNAMENT_ENTRY_SUBS,
      max: TOURNAMENT_ENTRY_MAX,
    },
    myRole: membership?.role || null,
    myTeam: membership
      ? {
          id: membership.team.id,
          name: membership.team.name,
          tag: membership.team.tag,
          members: membership.team.members.map((m) => ({
            userId: m.user.id,
            nick: m.user.nick || m.user.steamId,
            role: m.role,
          })),
        }
      : null,
    myEntry: myEntry
      ? {
          id: myEntry.id,
          createdAt: myEntry.createdAt.toISOString(),
          players: myEntry.players.map((p) => ({
            userId: p.user.id,
            nick: p.user.nick || "?",
            slot: p.slot,
          })),
        }
      : null,
    entries: entries.map((e) => ({
      id: e.id,
      team: e.team,
      createdAt: e.createdAt.toISOString(),
      players: e.players.map((p) => ({
        nick: p.user.nick || p.user.steamId,
        slot: p.slot,
      })),
    })),
  });
}

/** POST — подать / обновить заявку (капитан или зам) */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isRegistrationOpen(ACTIVE_TOURNAMENT)) {
    return NextResponse.json(
      { error: "Регистрация закрыта" },
      { status: 403 }
    );
  }

  const me = await prisma.user.findUnique({
    where: { steamId: session.user.steamId },
    select: { id: true },
  });
  if (!me) return NextResponse.json({ error: "no user" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    starterIds?: string[];
    subIds?: string[];
  };
  const starterIds = Array.isArray(body.starterIds)
    ? [...new Set(body.starterIds.map(String))]
    : [];
  const subIds = Array.isArray(body.subIds)
    ? [...new Set(body.subIds.map(String))]
    : [];

  if (starterIds.length !== TOURNAMENT_ENTRY_STARTERS) {
    return NextResponse.json(
      {
        error: `Нужно ровно ${TOURNAMENT_ENTRY_STARTERS} основных игроков`,
      },
      { status: 400 }
    );
  }
  if (subIds.length > TOURNAMENT_ENTRY_SUBS) {
    return NextResponse.json(
      { error: `Замен не больше ${TOURNAMENT_ENTRY_SUBS}` },
      { status: 400 }
    );
  }
  const overlap = starterIds.filter((id) => subIds.includes(id));
  if (overlap.length) {
    return NextResponse.json(
      { error: "Игрок не может быть и основным, и заменой" },
      { status: 400 }
    );
  }

  const membership = await prisma.tournamentTeamMember.findFirst({
    where: {
      userId: me.id,
      role: { in: ["CAPTAIN", "DEPUTY"] },
    },
  });
  if (!membership) {
    return NextResponse.json(
      { error: "Заявку подаёт капитан или зам" },
      { status: 403 }
    );
  }

  const allIds = [...starterIds, ...subIds];
  const members = await prisma.tournamentTeamMember.findMany({
    where: { teamId: membership.teamId, userId: { in: allIds } },
    select: { userId: true },
  });
  if (members.length !== allIds.length) {
    return NextResponse.json(
      { error: "Все выбранные игроки должны быть в вашей команде" },
      { status: 400 }
    );
  }

  const existing = await prisma.tournamentEntry.findUnique({
    where: {
      tournamentId_teamId: {
        tournamentId: TID,
        teamId: membership.teamId,
      },
    },
  });

  if (existing?.status === "CONFIRMED") {
    return NextResponse.json(
      { error: "Команда уже зарегистрирована" },
      { status: 409 }
    );
  }

  const entry = await prisma.$transaction(async (tx) => {
    if (existing) {
      await tx.tournamentEntryPlayer.deleteMany({
        where: { entryId: existing.id },
      });
      return tx.tournamentEntry.update({
        where: { id: existing.id },
        data: {
          status: "CONFIRMED",
          submittedBy: me.id,
          players: {
            create: [
              ...starterIds.map((userId, ord) => ({
                userId,
                slot: "STARTER" as const,
                ord,
              })),
              ...subIds.map((userId, ord) => ({
                userId,
                slot: "SUB" as const,
                ord,
              })),
            ],
          },
        },
        include: {
          team: { select: { id: true, name: true, tag: true } },
        },
      });
    }
    return tx.tournamentEntry.create({
      data: {
        tournamentId: TID,
        teamId: membership.teamId,
        submittedBy: me.id,
        status: "CONFIRMED",
        players: {
          create: [
            ...starterIds.map((userId, ord) => ({
              userId,
              slot: "STARTER" as const,
              ord,
            })),
            ...subIds.map((userId, ord) => ({
              userId,
              slot: "SUB" as const,
              ord,
            })),
          ],
        },
      },
      include: {
        team: { select: { id: true, name: true, tag: true } },
      },
    });
  });

  return NextResponse.json({
    ok: true,
    entry: {
      id: entry.id,
      team: entry.team,
      createdAt: entry.createdAt.toISOString(),
    },
  });
}

/** DELETE — отменить заявку (капитан или зам, в срок) */
export async function DELETE() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canWithdrawEntry(ACTIVE_TOURNAMENT)) {
    return NextResponse.json(
      { error: "Срок отмены регистрации истёк" },
      { status: 403 }
    );
  }

  const me = await prisma.user.findUnique({
    where: { steamId: session.user.steamId },
    select: { id: true },
  });
  if (!me) return NextResponse.json({ error: "no user" }, { status: 401 });

  const membership = await prisma.tournamentTeamMember.findFirst({
    where: {
      userId: me.id,
      role: { in: ["CAPTAIN", "DEPUTY"] },
    },
  });
  if (!membership) {
    return NextResponse.json(
      { error: "Отменить может капитан или зам" },
      { status: 403 }
    );
  }

  const entry = await prisma.tournamentEntry.findUnique({
    where: {
      tournamentId_teamId: {
        tournamentId: TID,
        teamId: membership.teamId,
      },
    },
  });
  if (!entry || entry.status !== "CONFIRMED") {
    return NextResponse.json({ error: "Активной заявки нет" }, { status: 404 });
  }

  await prisma.tournamentEntry.update({
    where: { id: entry.id },
    data: { status: "CANCELLED" },
  });

  return NextResponse.json({ ok: true });
}
