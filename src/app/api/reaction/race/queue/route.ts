import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  advanceRaceRoom,
  cancelRaceMatch,
  getAuthUserId,
  joinRaceQueue,
  loadRacePeers,
  normalizeCapacity,
  publicRaceView,
} from "@/lib/raceMatch";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }
  const user = await getAuthUserId(session.user.steamId);
  if (!user) {
    return NextResponse.json({ error: "Не найден" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const action =
    body?.action === "leave" || body?.action === "cancel" ? "leave" : "join";

  if (action === "leave") {
    const roomId = body?.roomId ? String(body.roomId) : undefined;
    await cancelRaceMatch(user.id, roomId);
    return NextResponse.json({ ok: true, left: true, cancelled: true });
  }

  const capacity = normalizeCapacity(body?.capacity);
  const room = await joinRaceQueue(user.id, capacity);
  if (!room) {
    return NextResponse.json({ error: "Не удалось создать комнату" }, { status: 500 });
  }

  const players = await loadRacePeers(room);
  const host = players.find((p) => p.userId === room.hostUserId) || null;
  const guest = room.guestUserId
    ? players.find((p) => p.userId === room.guestUserId) || null
    : null;

  return NextResponse.json({
    ok: true,
    room: publicRaceView(room, user.id),
    players,
    host: host
      ? { nick: host.nick, raceRating: host.raceRating }
      : null,
    guest: guest
      ? { nick: guest.nick, raceRating: guest.raceRating }
      : null,
    myRating: user.raceRating,
  });
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }
  const user = await getAuthUserId(session.user.steamId);
  if (!user) {
    return NextResponse.json({ error: "Не найден" }, { status: 404 });
  }

  const room = await prisma.reactionRaceRoom.findFirst({
    where: {
      status: { in: ["waiting", "countdown", "racing", "done", "cancelled"] },
      OR: [
        { hostUserId: user.id },
        { guestUserId: user.id },
        { guest2UserId: user.id },
      ],
      updatedAt: { gt: new Date(Date.now() - 120_000) },
    },
    orderBy: { updatedAt: "desc" },
  });

  if (!room || room.status === "done" || room.status === "cancelled") {
    if (room?.status === "done") {
      const advanced = await advanceRaceRoom(room.id);
      const players = advanced ? await loadRacePeers(advanced) : [];
      return NextResponse.json({
        ok: true,
        room: publicRaceView(advanced, user.id),
        players,
        myRating: user.raceRating,
      });
    }
    if (room?.status === "cancelled") {
      return NextResponse.json({
        ok: true,
        room: publicRaceView(room, user.id),
        players: [],
        myRating: user.raceRating,
      });
    }
    return NextResponse.json({ ok: true, room: null, players: [], myRating: user.raceRating });
  }

  const advanced = await advanceRaceRoom(room.id);
  const players = advanced ? await loadRacePeers(advanced) : [];
  const host = players.find((p) => p.userId === advanced!.hostUserId) || null;
  const guest = advanced?.guestUserId
    ? players.find((p) => p.userId === advanced.guestUserId) || null
    : null;

  return NextResponse.json({
    ok: true,
    room: publicRaceView(advanced, user.id),
    players,
    host: host
      ? { nick: host.nick, raceRating: host.raceRating }
      : null,
    guest: guest
      ? { nick: guest.nick, raceRating: guest.raceRating }
      : null,
    myRating: user.raceRating,
  });
}
