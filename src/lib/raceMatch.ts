import { prisma } from "@/lib/prisma";
import {
  RACE_COUNTDOWN_MS,
  RACE_QUEUE_TIMEOUT_MS,
  RACE_TICK_MS,
  raceEloDelta,
} from "@/lib/reaction";
import {
  createRaceState,
  EMPTY_KEYS,
  tickRace,
  type RaceKeys,
  type RaceState,
} from "@/lib/raceEngine";
import type { Prisma } from "@prisma/client";

type InputsMap = Record<string, RaceKeys & { at?: number }>;

function asState(raw: unknown): RaceState | null {
  if (!raw || typeof raw !== "object") return null;
  return raw as RaceState;
}

function asInputs(raw: unknown): InputsMap {
  if (!raw || typeof raw !== "object") return {};
  return raw as InputsMap;
}

export async function getAuthUserId(steamId: string) {
  return prisma.user.findUnique({
    where: { steamId },
    select: { id: true, nick: true, steamName: true, raceRating: true },
  });
}

/** Продвинуть комнату: countdown→racing, тики физики, Elo один раз */
export async function advanceRaceRoom(roomId: string) {
  const room = await prisma.reactionRaceRoom.findUnique({
    where: { id: roomId },
  });
  if (!room) return null;

  const now = Date.now();

  if (room.status === "waiting") {
    if (now - room.createdAt.getTime() > RACE_QUEUE_TIMEOUT_MS) {
      return prisma.reactionRaceRoom.update({
        where: { id: roomId },
        data: { status: "cancelled" },
      });
    }
    return room;
  }

  if (room.status === "countdown") {
    const ends = room.countdownEndsAt?.getTime() ?? 0;
    if (now >= ends && room.guestUserId) {
      const state = createRaceState(room.seed, room.hostUserId, room.guestUserId);
      return prisma.reactionRaceRoom.update({
        where: { id: roomId },
        data: {
          status: "racing",
          state: state as unknown as Prisma.InputJsonValue,
          inputs: {
            [room.hostUserId]: { ...EMPTY_KEYS, at: now },
            [room.guestUserId]: { ...EMPTY_KEYS, at: now },
          },
        },
      });
    }
    return room;
  }

  if (room.status !== "racing") return room;

  let state = asState(room.state);
  if (!state || !room.guestUserId) return room;

  const inputs = asInputs(room.inputs);
  const elapsed = now - (state.startedAt || room.updatedAt.getTime());
  const targetTick = Math.floor(elapsed / RACE_TICK_MS);
  const dt = Math.max(0, Math.min(40, targetTick - state.tick));
  if (dt > 0) {
    const cleanInputs: Record<string, RaceKeys> = {
      [room.hostUserId]: inputs[room.hostUserId] || EMPTY_KEYS,
      [room.guestUserId]: inputs[room.guestUserId] || EMPTY_KEYS,
    };
    state = tickRace(state, cleanInputs, dt);
  }

  if (state.winnerUserId && !room.ratingApplied) {
    return applyRaceResult(room.id, state);
  }

  if (dt > 0) {
    return prisma.reactionRaceRoom.update({
      where: { id: roomId },
      data: { state: state as unknown as Prisma.InputJsonValue },
    });
  }
  return room;
}

async function applyRaceResult(roomId: string, state: RaceState) {
  return prisma.$transaction(async (tx) => {
    const room = await tx.reactionRaceRoom.findUnique({ where: { id: roomId } });
    if (!room || room.ratingApplied || !room.guestUserId || !state.winnerUserId) {
      return room;
    }

    const [host, guest] = await Promise.all([
      tx.user.findUnique({
        where: { id: room.hostUserId },
        select: { id: true, raceRating: true },
      }),
      tx.user.findUnique({
        where: { id: room.guestUserId },
        select: { id: true, raceRating: true },
      }),
    ]);
    if (!host || !guest) return room;

    const hostWon = state.winnerUserId === host.id;
    const elo = raceEloDelta(host.raceRating, guest.raceRating, hostWon);

    await tx.user.update({
      where: { id: host.id },
      data: { raceRating: elo.nextA },
    });
    await tx.user.update({
      where: { id: guest.id },
      data: { raceRating: elo.nextB },
    });

    return tx.reactionRaceRoom.update({
      where: { id: roomId },
      data: {
        status: "done",
        winnerUserId: state.winnerUserId,
        ratingApplied: true,
        state: state as unknown as Prisma.InputJsonValue,
        ratingResult: {
          beforeHost: host.raceRating,
          beforeGuest: guest.raceRating,
          deltaHost: elo.deltaA,
          deltaGuest: elo.deltaB,
          afterHost: elo.nextA,
          afterGuest: elo.nextB,
        },
      },
    });
  });
}

export async function joinRaceQueue(userId: string) {
  // cancel stale waiting by this user
  await prisma.reactionRaceRoom.updateMany({
    where: {
      status: "waiting",
      hostUserId: userId,
      guestUserId: null,
    },
    data: { status: "cancelled" },
  });

  // already in active match?
  const existing = await prisma.reactionRaceRoom.findFirst({
    where: {
      status: { in: ["waiting", "countdown", "racing"] },
      OR: [{ hostUserId: userId }, { guestUserId: userId }],
    },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    return advanceRaceRoom(existing.id);
  }

  // find open waiting room
  const open = await prisma.reactionRaceRoom.findFirst({
    where: {
      status: "waiting",
      guestUserId: null,
      hostUserId: { not: userId },
      createdAt: { gt: new Date(Date.now() - RACE_QUEUE_TIMEOUT_MS) },
    },
    orderBy: { createdAt: "asc" },
  });

  if (open) {
    const updated = await prisma.reactionRaceRoom.update({
      where: { id: open.id },
      data: {
        guestUserId: userId,
        status: "countdown",
        countdownEndsAt: new Date(Date.now() + RACE_COUNTDOWN_MS),
      },
    });
    return advanceRaceRoom(updated.id);
  }

  return prisma.reactionRaceRoom.create({
    data: {
      status: "waiting",
      seed: Math.floor(Math.random() * 1_000_000_000),
      hostUserId: userId,
    },
  });
}

export async function leaveRaceQueue(userId: string) {
  await prisma.reactionRaceRoom.updateMany({
    where: {
      status: "waiting",
      hostUserId: userId,
      guestUserId: null,
    },
    data: { status: "cancelled" },
  });
}

export async function setRaceInput(
  roomId: string,
  userId: string,
  keys: RaceKeys
) {
  const room = await prisma.reactionRaceRoom.findUnique({ where: { id: roomId } });
  if (!room) return null;
  if (room.hostUserId !== userId && room.guestUserId !== userId) return null;
  if (room.status !== "racing" && room.status !== "countdown") {
    return advanceRaceRoom(roomId);
  }

  const inputs = asInputs(room.inputs);
  inputs[userId] = { ...keys, at: Date.now() };
  await prisma.reactionRaceRoom.update({
    where: { id: roomId },
    data: { inputs: inputs as unknown as Prisma.InputJsonValue },
  });
  return advanceRaceRoom(roomId);
}

export function publicRaceView(
  room: Awaited<ReturnType<typeof advanceRaceRoom>>,
  viewerId: string
) {
  if (!room) return null;
  const state = asState(room.state);
  return {
    id: room.id,
    status: room.status,
    seed: room.seed,
    hostUserId: room.hostUserId,
    guestUserId: room.guestUserId,
    winnerUserId: room.winnerUserId,
    countdownEndsAt: room.countdownEndsAt?.toISOString() ?? null,
    youAreHost: room.hostUserId === viewerId,
    state,
    ratingResult: room.ratingResult,
  };
}
