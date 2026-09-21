import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  advanceRaceRoom,
  getAuthUserId,
  joinRaceQueue,
  leaveRaceQueue,
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
  const action = body?.action === "leave" ? "leave" : "join";

  if (action === "leave") {
    await leaveRaceQueue(user.id);
    return NextResponse.json({ ok: true, left: true });
  }

  const room = await joinRaceQueue(user.id);
  if (!room) {
    return NextResponse.json({ error: "Не удалось создать комнату" }, { status: 500 });
  }

  const host = await prisma.user.findUnique({
    where: { id: room.hostUserId },
    select: { nick: true, steamName: true, raceRating: true },
  });
  const guest = room.guestUserId
    ? await prisma.user.findUnique({
        where: { id: room.guestUserId },
        select: { nick: true, steamName: true, raceRating: true },
      })
    : null;

  return NextResponse.json({
    ok: true,
    room: publicRaceView(room, user.id),
    host: host
      ? {
          nick: host.nick || host.steamName || "Игрок",
          raceRating: host.raceRating,
        }
      : null,
    guest: guest
      ? {
          nick: guest.nick || guest.steamName || "Игрок",
          raceRating: guest.raceRating,
        }
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
      status: { in: ["waiting", "countdown", "racing", "done"] },
      OR: [{ hostUserId: user.id }, { guestUserId: user.id }],
    },
    orderBy: { updatedAt: "desc" },
  });

  if (!room || room.status === "done") {
    // still return last done briefly
    if (room?.status === "done") {
      const advanced = await advanceRaceRoom(room.id);
      return NextResponse.json({
        ok: true,
        room: publicRaceView(advanced, user.id),
        myRating: user.raceRating,
      });
    }
    return NextResponse.json({ ok: true, room: null, myRating: user.raceRating });
  }

  const advanced = await advanceRaceRoom(room.id);
  const host = await prisma.user.findUnique({
    where: { id: advanced!.hostUserId },
    select: { nick: true, steamName: true, raceRating: true },
  });
  const guest = advanced?.guestUserId
    ? await prisma.user.findUnique({
        where: { id: advanced.guestUserId },
        select: { nick: true, steamName: true, raceRating: true },
      })
    : null;

  return NextResponse.json({
    ok: true,
    room: publicRaceView(advanced, user.id),
    host: host
      ? { nick: host.nick || host.steamName || "Игрок", raceRating: host.raceRating }
      : null,
    guest: guest
      ? {
          nick: guest.nick || guest.steamName || "Игрок",
          raceRating: guest.raceRating,
        }
      : null,
    myRating: user.raceRating,
  });
}
