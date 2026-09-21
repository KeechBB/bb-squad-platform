import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  advanceRaceRoom,
  getAuthUserId,
  isInRaceRoom,
  loadRacePeers,
  publicRaceView,
  setRaceInput,
} from "@/lib/raceMatch";
import { EMPTY_KEYS, type RaceKeys } from "@/lib/raceEngine";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseKeys(raw: unknown): RaceKeys {
  if (!raw || typeof raw !== "object") return { ...EMPTY_KEYS };
  const o = raw as Record<string, unknown>;
  return {
    up: Boolean(o.up),
    down: Boolean(o.down),
    left: Boolean(o.left),
    right: Boolean(o.right),
  };
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }
  const user = await getAuthUserId(session.user.steamId);
  if (!user) {
    return NextResponse.json({ error: "Не найден" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const roomId = String(body?.roomId || "");
  if (!roomId) {
    return NextResponse.json({ error: "Нужен roomId" }, { status: 400 });
  }

  const room = await setRaceInput(roomId, user.id, parseKeys(body?.keys));
  if (!room) {
    return NextResponse.json({ error: "Комната недоступна" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    room: publicRaceView(room, user.id),
  });
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.steamId || !session.user.profileComplete) {
    return NextResponse.json({ error: "Нужен вход" }, { status: 401 });
  }
  const user = await getAuthUserId(session.user.steamId);
  if (!user) {
    return NextResponse.json({ error: "Не найден" }, { status: 404 });
  }

  const url = new URL(req.url);
  const roomId = url.searchParams.get("roomId");
  if (!roomId) {
    return NextResponse.json({ error: "Нужен roomId" }, { status: 400 });
  }

  const room = await prisma.reactionRaceRoom.findUnique({ where: { id: roomId } });
  if (!room) {
    return NextResponse.json({ error: "Нет комнаты" }, { status: 404 });
  }
  if (!isInRaceRoom(room, user.id)) {
    return NextResponse.json({ error: "Чужая комната" }, { status: 403 });
  }

  const advanced = await advanceRaceRoom(roomId);
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
