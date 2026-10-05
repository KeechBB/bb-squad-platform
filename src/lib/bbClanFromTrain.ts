import { prisma } from "@/lib/prisma";
import { findBlackberryClanIds } from "@/lib/reserve";
import { TRAINING_SERVER_KEYS } from "@/lib/squadServers";
import { loadKvJsonCached } from "@/lib/kvLocal";
import { nickCompact, nickKey } from "@/lib/nickIdentity";

export type BbClanFromTrainResult = {
  ok: boolean;
  clanId: string | null;
  fromSessions: number;
  fromLadder: number;
  candidates: number;
  alreadyInBb: number;
  inOtherClan: number;
  added: number;
  message: string;
};

/**
 * Разово / по кнопке: всех зареганных, кто светился на TR1/TR2
 * или в тренировочном RP-ladder, добавить в ClanMember BlackBerry.
 * Чужие кланы не трогаем.
 */
export async function addTrainPlayersToBlackberryClan(): Promise<BbClanFromTrainResult> {
  const empty = (msg: string): BbClanFromTrainResult => ({
    ok: false,
    clanId: null,
    fromSessions: 0,
    fromLadder: 0,
    candidates: 0,
    alreadyInBb: 0,
    inOtherClan: 0,
    added: 0,
    message: msg,
  });

  const clanIds = await findBlackberryClanIds();
  if (clanIds.length === 0) return empty("Клан BlackBerry не найден");
  const clanId = clanIds[0];

  const sessionRows = await prisma.squadServerSession.findMany({
    where: {
      serverKey: { in: [...TRAINING_SERVER_KEYS] },
      userId: { not: null },
    },
    distinct: ["userId"],
    select: { userId: true },
  });
  const fromSessions = new Set(
    sessionRows.map((r) => r.userId!).filter(Boolean)
  );

  const trainKeys = new Set<string>();
  const trainCompact = new Set<string>();
  try {
    const lad = await loadKvJsonCached<{
      leaderboard?: Array<{ nick?: string }>;
      players?: Record<string, { nick?: string }> | Array<{ nick?: string }>;
    }>("data/training/rp-ladder.json");
    const nicks: string[] = [];
    for (const p of lad?.leaderboard || []) {
      const n = String(p?.nick || "").trim();
      if (n) nicks.push(n);
    }
    const players = lad?.players;
    if (Array.isArray(players)) {
      for (const p of players) {
        const n = String(p?.nick || "").trim();
        if (n) nicks.push(n);
      }
    } else if (players && typeof players === "object") {
      for (const p of Object.values(players)) {
        const n = String(p?.nick || "").trim();
        if (n) nicks.push(n);
      }
    }
    for (const n of nicks) {
      trainKeys.add(nickKey(n));
      trainCompact.add(nickCompact(n));
    }
  } catch {
    /* ladder optional */
  }

  let fromLadderIds: string[] = [];
  if (trainKeys.size || trainCompact.size) {
    const users = await prisma.user.findMany({
      where: {
        profileComplete: true,
        OR: [{ nick: { not: null } }, { steamName: { not: null } }],
      },
      select: { id: true, nick: true, steamName: true },
    });
    fromLadderIds = users
      .filter((u) => {
        const label = (u.nick || u.steamName || "").trim();
        if (!label) return false;
        return (
          trainKeys.has(nickKey(label)) || trainCompact.has(nickCompact(label))
        );
      })
      .map((u) => u.id);
  }

  const candidateSet = new Set<string>([...fromSessions, ...fromLadderIds]);
  // только существующие пользователи с профилем
  const profiled = await prisma.user.findMany({
    where: {
      id: { in: [...candidateSet] },
      profileComplete: true,
    },
    select: { id: true },
  });
  const candidates = profiled.map((u) => u.id);

  if (!candidates.length) {
    return {
      ok: true,
      clanId,
      fromSessions: fromSessions.size,
      fromLadder: fromLadderIds.length,
      candidates: 0,
      alreadyInBb: 0,
      inOtherClan: 0,
      added: 0,
      message: "Нет зареганных кандидатов с TR1 / ladder",
    };
  }

  const memberships = await prisma.clanMember.findMany({
    where: { userId: { in: candidates } },
    select: { userId: true, clanId: true },
  });
  const inBb = new Set(
    memberships.filter((m) => clanIds.includes(m.clanId)).map((m) => m.userId)
  );
  const inOther = new Set(
    memberships.filter((m) => !clanIds.includes(m.clanId)).map((m) => m.userId)
  );
  const toAdd = candidates.filter((id) => !inBb.has(id) && !inOther.has(id));

  if (toAdd.length) {
    await prisma.clanMember.createMany({
      data: toAdd.map((userId) => ({
        clanId,
        userId,
        role: "MEMBER" as const,
      })),
      skipDuplicates: true,
    });
  }

  return {
    ok: true,
    clanId,
    fromSessions: fromSessions.size,
    fromLadder: fromLadderIds.length,
    candidates: candidates.length,
    alreadyInBb: inBb.size,
    inOtherClan: inOther.size,
    added: toAdd.length,
    message: `В клан добавлено ${toAdd.length} (уже в BB: ${inBb.size}, в другом клане: ${inOther.size})`,
  };
}
