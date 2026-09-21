import { prisma } from "@/lib/prisma";
import {
  RACE_COUNTDOWN_MS,
  RACE_MAX_CATCHUP_TICKS,
  RACE_QUEUE_TIMEOUT_MS,
  RACE_RATING_FLOOR,
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
import { RACE_MAPS } from "@/lib/raceMaps";
import type { Prisma, ReactionRaceRoom } from "@prisma/client";

type InputsMap = Record<string, RaceKeys & { at?: number }>;

export type RaceCapacity = 2 | 3;

export type RatingEntry = {
  userId: string;
  before: number;
  delta: number;
  after: number;
};

function asState(raw: unknown): RaceState | null {
  if (!raw || typeof raw !== "object") return null;
  return raw as RaceState;
}

function asInputs(raw: unknown): InputsMap {
  if (!raw || typeof raw !== "object") return {};
  return raw as InputsMap;
}

export function normalizeCapacity(raw: unknown): RaceCapacity {
  return raw === 3 || raw === "3" ? 3 : 2;
}

export function roomPlayerIds(room: {
  hostUserId: string;
  guestUserId: string | null;
  guest2UserId?: string | null;
}): string[] {
  return [room.hostUserId, room.guestUserId, room.guest2UserId ?? null].filter(
    (id): id is string => Boolean(id)
  );
}

export function isInRaceRoom(
  room: {
    hostUserId: string;
    guestUserId: string | null;
    guest2UserId?: string | null;
  },
  userId: string
) {
  return roomPlayerIds(room).includes(userId);
}

export async function getAuthUserId(steamId: string) {
  return prisma.user.findUnique({
    where: { steamId },
    select: { id: true, nick: true, steamName: true, raceRating: true },
  });
}

function emptyInputsFor(playerIds: string[], now: number): InputsMap {
  const inputs: InputsMap = {};
  for (const id of playerIds) {
    inputs[id] = { ...EMPTY_KEYS, at: now };
  }
  return inputs;
}

/** Продвинуть комнату: countdown→racing, тики физики, Elo один раз */
export async function advanceRaceRoom(roomId: string) {
  const room = await prisma.reactionRaceRoom.findUnique({
    where: { id: roomId },
  });
  if (!room) return null;

  const now = Date.now();
  const players = roomPlayerIds(room);
  const capacity = room.capacity === 3 ? 3 : 2;

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
    if (now >= ends && players.length >= capacity) {
      const state = createRaceState(room.seed, players);
      return prisma.reactionRaceRoom.update({
        where: { id: roomId },
        data: {
          status: "racing",
          state: state as unknown as Prisma.InputJsonValue,
          inputs: emptyInputsFor(players, now) as unknown as Prisma.InputJsonValue,
        },
      });
    }
    return room;
  }

  if (room.status !== "racing") return room;

  let state = asState(room.state);
  if (!state || players.length < 2) return room;

  const inputs = asInputs(room.inputs);
  const elapsed = now - (state.startedAt || room.updatedAt.getTime());
  const targetTick = Math.floor(elapsed / RACE_TICK_MS);
  const prevTick = state.tick;
  const dt = Math.max(0, Math.min(RACE_MAX_CATCHUP_TICKS, targetTick - prevTick));
  if (dt > 0) {
    const cleanInputs: Record<string, RaceKeys> = {};
    for (const id of players) {
      cleanInputs[id] = inputs[id] || EMPTY_KEYS;
    }
    state = tickRace(state, cleanInputs, dt);
  }

  if (state.winnerUserId && !room.ratingApplied) {
    return applyRaceResult(room.id, state);
  }

  if (dt > 0) {
    // Оптимистичная блокировка: не затираем чужой advance / input mid-write
    const wrote = await prisma.reactionRaceRoom.updateMany({
      where: { id: roomId, updatedAt: room.updatedAt, status: "racing" },
      data: { state: state as unknown as Prisma.InputJsonValue },
    });
    if (wrote.count === 0) {
      return prisma.reactionRaceRoom.findUnique({ where: { id: roomId } });
    }
    return prisma.reactionRaceRoom.findUnique({ where: { id: roomId } });
  }
  return room;
}

async function applyRaceResult(roomId: string, state: RaceState) {
  return prisma.$transaction(async (tx) => {
    const room = await tx.reactionRaceRoom.findUnique({ where: { id: roomId } });
    if (!room || room.ratingApplied || !state.winnerUserId) {
      return room;
    }

    const players = roomPlayerIds(room);
    if (!players.includes(state.winnerUserId) || players.length < 2) {
      return room;
    }

    const users = await tx.user.findMany({
      where: { id: { in: players } },
      select: { id: true, raceRating: true },
    });
    if (users.length !== players.length) return room;

    const byId = new Map(users.map((u) => [u.id, u.raceRating]));
    const winnerId = state.winnerUserId;
    const losers = players.filter((id) => id !== winnerId);
    const deltas = new Map<string, number>();
    for (const id of players) deltas.set(id, 0);

    // FFA: winner vs each loser (на стартовых рейтингах), средний прирост у победителя
    let winSum = 0;
    for (const loserId of losers) {
      const elo = raceEloDelta(byId.get(winnerId)!, byId.get(loserId)!, true);
      winSum += elo.deltaA;
      deltas.set(loserId, (deltas.get(loserId) || 0) + elo.deltaB);
    }
    deltas.set(winnerId, Math.round(winSum / losers.length));

    const entries: RatingEntry[] = [];
    for (const id of players) {
      const before = byId.get(id)!;
      const delta = deltas.get(id) || 0;
      const after = Math.max(RACE_RATING_FLOOR, before + delta);
      entries.push({ userId: id, before, delta: after - before, after });
      await tx.user.update({
        where: { id },
        data: { raceRating: after },
      });
    }

    const hostEntry = entries.find((e) => e.userId === room.hostUserId);
    const guestEntry = room.guestUserId
      ? entries.find((e) => e.userId === room.guestUserId)
      : null;

    return tx.reactionRaceRoom.update({
      where: { id: roomId },
      data: {
        status: "done",
        winnerUserId: state.winnerUserId,
        ratingApplied: true,
        state: state as unknown as Prisma.InputJsonValue,
        ratingResult: {
          entries,
          // совместимость со старым UI 1v1
          beforeHost: hostEntry?.before ?? null,
          beforeGuest: guestEntry?.before ?? null,
          deltaHost: hostEntry?.delta ?? null,
          deltaGuest: guestEntry?.delta ?? null,
          afterHost: hostEntry?.after ?? null,
          afterGuest: guestEntry?.after ?? null,
        },
      },
    });
  });
}

function freeSlotData(
  room: ReactionRaceRoom,
  userId: string
): { guestUserId?: string; guest2UserId?: string } | null {
  if (room.hostUserId === userId) return null;
  if (room.guestUserId === userId || room.guest2UserId === userId) return null;
  if (!room.guestUserId) return { guestUserId: userId };
  const capacity = room.capacity === 3 ? 3 : 2;
  if (capacity >= 3 && !room.guest2UserId) return { guest2UserId: userId };
  return null;
}

export async function joinRaceQueue(userId: string, capacity: RaceCapacity = 2) {
  await prisma.reactionRaceRoom.updateMany({
    where: {
      status: "waiting",
      hostUserId: userId,
      guestUserId: null,
      guest2UserId: null,
    },
    data: { status: "cancelled" },
  });

  const existing = await prisma.reactionRaceRoom.findFirst({
    where: {
      status: { in: ["waiting", "countdown", "racing"] },
      OR: [
        { hostUserId: userId },
        { guestUserId: userId },
        { guest2UserId: userId },
      ],
    },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    return advanceRaceRoom(existing.id);
  }

  const openRooms = await prisma.reactionRaceRoom.findMany({
    where: {
      status: "waiting",
      capacity,
      hostUserId: { not: userId },
      createdAt: { gt: new Date(Date.now() - RACE_QUEUE_TIMEOUT_MS) },
    },
    orderBy: { createdAt: "asc" },
    take: 20,
  });

  for (const open of openRooms) {
    const slot = freeSlotData(open, userId);
    if (!slot) continue;

    const nextGuest = slot.guestUserId ?? open.guestUserId;
    const nextGuest2 = slot.guest2UserId ?? open.guest2UserId;
    const filled = [open.hostUserId, nextGuest, nextGuest2].filter(Boolean).length;
    const full = filled >= capacity;

    const updated = await prisma.reactionRaceRoom.update({
      where: { id: open.id },
      data: {
        ...slot,
        ...(full
          ? {
              status: "countdown",
              countdownEndsAt: new Date(Date.now() + RACE_COUNTDOWN_MS),
            }
          : {}),
      },
    });
    return advanceRaceRoom(updated.id);
  }

  return prisma.reactionRaceRoom.create({
    data: {
      status: "waiting",
      seed:
        Math.floor(Math.random() * RACE_MAPS.length) +
        Math.floor(Math.random() * 1000) * RACE_MAPS.length,
      hostUserId: userId,
      capacity,
    },
  });
}

export async function leaveRaceQueue(userId: string) {
  const waiting = await prisma.reactionRaceRoom.findMany({
    where: {
      status: "waiting",
      OR: [
        { hostUserId: userId },
        { guestUserId: userId },
        { guest2UserId: userId },
      ],
    },
  });

  for (const room of waiting) {
    if (room.hostUserId === userId) {
      await prisma.reactionRaceRoom.update({
        where: { id: room.id },
        data: { status: "cancelled" },
      });
      continue;
    }
    const data: { guestUserId?: null; guest2UserId?: null } = {};
    if (room.guestUserId === userId) data.guestUserId = null;
    if (room.guest2UserId === userId) data.guest2UserId = null;
    if (Object.keys(data).length) {
      await prisma.reactionRaceRoom.update({
        where: { id: room.id },
        data,
      });
    }
  }
}

export async function setRaceInput(
  roomId: string,
  userId: string,
  keys: RaceKeys
) {
  const room = await prisma.reactionRaceRoom.findUnique({ where: { id: roomId } });
  if (!room) return null;
  if (!isInRaceRoom(room, userId)) return null;
  if (room.status !== "racing" && room.status !== "countdown") {
    return room;
  }

  const inputs = asInputs(room.inputs);
  inputs[userId] = { ...keys, at: Date.now() };
  // Только входы — физику крутит GET / advance, иначе клиенты затирают state друг другу
  return prisma.reactionRaceRoom.update({
    where: { id: roomId },
    data: { inputs: inputs as unknown as Prisma.InputJsonValue },
  });
}

export function publicRaceView(
  room: Awaited<ReturnType<typeof advanceRaceRoom>>,
  viewerId: string
) {
  if (!room) return null;
  const state = asState(room.state);
  const capacity = room.capacity === 3 ? 3 : 2;
  return {
    id: room.id,
    status: room.status,
    seed: room.seed,
    capacity,
    hostUserId: room.hostUserId,
    guestUserId: room.guestUserId,
    guest2UserId: room.guest2UserId,
    playerIds: roomPlayerIds(room),
    winnerUserId: room.winnerUserId,
    countdownEndsAt: room.countdownEndsAt?.toISOString() ?? null,
    youAreHost: room.hostUserId === viewerId,
    state,
    ratingResult: room.ratingResult,
  };
}

export async function loadRacePeers(room: {
  hostUserId: string;
  guestUserId: string | null;
  guest2UserId?: string | null;
}) {
  const ids = roomPlayerIds(room);
  if (!ids.length) return [];
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, nick: true, steamName: true, raceRating: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));
  return ids.map((id) => {
    const u = byId.get(id);
    return {
      userId: id,
      nick: u?.nick || u?.steamName || "Игрок",
      raceRating: u?.raceRating ?? 1000,
    };
  });
}
