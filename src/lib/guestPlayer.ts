/**
 * Профили соперников (DCAI и др.) без аккаунта сайта — стата по Steam/нику из логов.
 */
import { prisma } from "@/lib/prisma";
import { nickKey, nickCompact } from "@/lib/nickIdentity";
import { normalizeSteamId } from "@/lib/squadSessions";
import { isTrainingServerKey } from "@/lib/squadServers";
import {
  attendanceCanonStartUtc,
  trainingDayVisitBoundsFromSessions,
  trainingDayYmd,
} from "@/lib/squadSessions";
import type { TrainingLaneStats } from "@/lib/trainingStats";
import { bonesForSteamIds } from "@/lib/squadHits";
import {
  kitsForSteamIds,
  kitDaysForSteamIds,
  type KitsLane,
} from "@/lib/squadRoles";

const EXTERNAL_LEADER_STEAM_PREFIX = "7656119900001";
const LIST_LIMIT = 80;

export type GuestPlayerIdentity = {
  nick: string;
  steamIds: string[];
  userId: string | null;
};

function nickMatches(a: string, b: string): boolean {
  const ka = nickKey(a);
  const kb = nickKey(b);
  if (ka && kb && ka === kb) return true;
  const ca = nickCompact(a);
  const cb = nickCompact(b);
  return Boolean(ca && cb && ca === cb);
}

/** Резолв ника → Steam(ы) + опциональный userId (не синтетический глава). */
export async function resolveGuestPlayerIdentity(
  nickRaw: string
): Promise<GuestPlayerIdentity> {
  const nick = String(nickRaw || "").trim();
  const empty: GuestPlayerIdentity = { nick, steamIds: [], userId: null };
  if (!nick) return empty;

  const steamSet = new Set<string>();

  const user = await prisma.user.findFirst({
    where: {
      nick: { equals: nick, mode: "insensitive" },
      profileComplete: true,
      NOT: { steamId: { startsWith: EXTERNAL_LEADER_STEAM_PREFIX } },
    },
    select: { id: true, steamId: true, nick: true },
  });
  if (user) {
    const sid = normalizeSteamId(user.steamId) || user.steamId;
    if (sid) steamSet.add(sid);
    return {
      nick: user.nick || nick,
      steamIds: [...steamSet],
      userId: user.id,
    };
  }

  const sessions = await prisma.squadServerSession.findMany({
    where: {
      nickAtJoin: { equals: nick, mode: "insensitive" },
    },
    select: { steamId: true, nickAtJoin: true },
    take: 40,
    orderBy: { joinedAt: "desc" },
  });
  for (const s of sessions) {
    if (!nickMatches(s.nickAtJoin || "", nick)) continue;
    const sid = normalizeSteamId(s.steamId) || s.steamId;
    if (sid) steamSet.add(sid);
  }

  const eos = await prisma.squadEosSteamMap.findMany({
    where: { nick: { equals: nick, mode: "insensitive" } },
    select: { steamId: true, nick: true },
    take: 20,
  });
  for (const e of eos) {
    if (e.nick && !nickMatches(e.nick, nick)) continue;
    const sid = normalizeSteamId(e.steamId) || e.steamId;
    if (sid) steamSet.add(sid);
  }

  const nk = nickKey(nick);
  const pending = await prisma.clanPendingMember.findMany({
    where: nk
      ? {
          OR: [
            { nickKey: nk },
            { nick: { equals: nick, mode: "insensitive" } },
          ],
        }
      : { nick: { equals: nick, mode: "insensitive" } },
    select: { steamId: true, nick: true },
    take: 10,
  });
  for (const p of pending) {
    if (p.nick && !nickMatches(p.nick, nick)) continue;
    const sid = normalizeSteamId(p.steamId || "") || p.steamId;
    if (sid) steamSet.add(sid);
  }

  // нечёткий поиск по nickAtJoin (теги клана в нике)
  if (steamSet.size === 0) {
    const compact = nickCompact(nick);
    if (compact.length >= 3) {
      const fuzzy = await prisma.squadServerSession.findMany({
        where: {
          nickAtJoin: { contains: nick.slice(0, 12), mode: "insensitive" },
        },
        select: { steamId: true, nickAtJoin: true },
        take: 80,
        orderBy: { joinedAt: "desc" },
      });
      for (const s of fuzzy) {
        if (!nickMatches(s.nickAtJoin || "", nick)) continue;
        const sid = normalizeSteamId(s.steamId) || s.steamId;
        if (sid) steamSet.add(sid);
      }
    }
  }

  return { nick, steamIds: [...steamSet], userId: null };
}

function laneFromSessions(
  lean: {
    id: string;
    joinedAt: Date;
    leftAt: Date | null;
    nickAtJoin: string | null;
    serverKey: string;
  }[],
  since: Date,
  serverFilter?: "TR1" | "TR2" | null
): TrainingLaneStats {
  const filtered = lean.filter((s) => {
    if (!isTrainingServerKey(s.serverKey)) return false;
    if (serverFilter) {
      return (s.serverKey || "").toUpperCase() === serverFilter;
    }
    return true;
  });

  const forAtt = filtered.map((s) => ({
    joinedAt: s.joinedAt,
    leftAt: s.leftAt,
    serverKey: s.serverKey,
  }));

  // Для соперников: «был» = любой заход на TR*, не только окно 21:00
  const present = new Set<string>();
  const late = new Set<string>();
  for (const s of forAtt) {
    present.add(trainingDayYmd(s.joinedAt));
  }
  const visitBoundsMap = trainingDayVisitBoundsFromSessions(forAtt);
  const visitBounds: Record<string, { joinHm: string; leaveHm: string | null }> =
    {};
  for (const [day, b] of visitBoundsMap) {
    visitBounds[day] = b;
  }

  const minsByDay = new Map<string, number>();
  for (const s of filtered) {
    if (s.joinedAt < since) continue;
    const end = s.leftAt ?? new Date();
    const mins = Math.max(
      0,
      Math.round((end.getTime() - s.joinedAt.getTime()) / 60_000)
    );
    if (mins <= 0) continue;
    const day = trainingDayYmd(s.joinedAt);
    minsByDay.set(day, (minsByDay.get(day) || 0) + mins);
  }

  return {
    sessions: filtered.slice(0, LIST_LIMIT),
    presentDays: [...present],
    lateDays: [...late],
    reserveDays: [],
    visitBounds,
    minutes30d: [...minsByDay.values()].reduce((a, b) => a + b, 0),
    sessions30d: minsByDay.size,
    openNow: filtered.some((s) => s.leftAt == null),
  };
}

/** Посещаемость TR1/TR2 по списку Steam (без userId). */
export async function loadGuestTrainingStats(steamIds: string[]) {
  const ids = [...new Set(steamIds.map((s) => normalizeSteamId(s) || s).filter(Boolean))];
  const empty = laneFromSessions([], new Date(0), null);
  if (!ids.length) {
    return { ...empty, tr1: empty, tr2: empty };
  }

  const canonStart = attendanceCanonStartUtc();
  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const since = since30 > canonStart ? since30 : canonStart;

  const lean = await prisma.squadServerSession.findMany({
    where: {
      steamId: { in: ids },
      joinedAt: { gte: canonStart },
    },
    orderBy: { joinedAt: "desc" },
    select: {
      id: true,
      joinedAt: true,
      leftAt: true,
      nickAtJoin: true,
      serverKey: true,
    },
  });

  const combined = laneFromSessions(lean, since, null);
  const tr1 = laneFromSessions(lean, since, "TR1");
  const tr2 = laneFromSessions(lean, since, "TR2");
  return { ...combined, tr1, tr2 };
}

export async function loadGuestHitBones(steamIds: string[]) {
  return bonesForSteamIds(steamIds);
}

export async function loadGuestKits(
  steamIds: string[],
  lane: KitsLane,
  opts: { dayYmd?: string | null; fromYmd?: string | null; toYmd?: string | null } = {}
) {
  return kitsForSteamIds(steamIds, {
    ...opts,
    lane,
    combatWindow: false,
  });
}

export async function loadGuestKitDays(steamIds: string[], lane: KitsLane) {
  return kitDaysForSteamIds(steamIds, lane, { combatWindow: false });
}
