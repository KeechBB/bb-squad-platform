/**
 * Clan stats for PB1 (public) only — averages, players, maps, role pie (30d).
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildPublicRatingTable, type PublicCombatRow } from "@/lib/publicCombat";
import { rollingClanPublicRoleWindow } from "@/lib/mainRoleWindow";
import { mskRangeBoundsUtc } from "@/lib/squadRoles";
import { PUBLIC_SERVER_KEYS } from "@/lib/squadServers";
import { normalizeSteamId } from "@/lib/squadSessions";
import { canonKitName } from "@/lib/squadKits";
import { normalizeClanTag } from "@/lib/clanMapColor";
import {
  collisionBySiteNick,
  publicRpLookupNick,
} from "@/lib/nickCollisions";

/** Сколько главных ролей показывать на диаграмме (самые популярные). */
const POPULAR_ROLE_LIMIT = 6;

function nickKey(n: string) {
  return String(n || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function fmtHours(sec: number): string {
  const h = sec / 3600;
  if (h < 10) return `${Math.round(h * 10) / 10} ч`;
  return `${Math.round(h)} ч`;
}

function fmtSession(sec: number): string {
  if (!sec || sec <= 0) return "—";
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} м`;
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${hh} ч ${mm} м` : `${hh} ч`;
}

export type ClanPublicRolePlayer = {
  nick: string;
  userId: string;
  hours: number;
  hoursLabel: string;
  sec: number;
};

export type ClanPublicRoleSlice = {
  kit: string;
  players: number;
  hours: number;
  hoursLabel: string;
  pct: number;
  members: ClanPublicRolePlayer[];
};

export type ClanPublicPlayerRow = {
  nick: string;
  steamId: string | null;
  nok: number;
  kills: number;
  deaths: number;
  res: number;
  kd: number;
  winPct: number | null;
  games: number;
  mvpKiller: number;
  mvpMedic: number;
};

export type ClanPublicMapRow = {
  map: string;
  games: number;
  wins: number;
  winPct: number;
};

export type ClanPublicAverages = {
  avgKills: number;
  avgNok: number;
  avgRes: number;
  avgDeaths: number;
  avgKd: number;
  avgWinrate: number | null;
  avgSessionLabel: string;
  avgVehicleKills: number;
  mvpMedicTotal: number;
  mvpKillerTotal: number;
};

export type ClanPublicStats = {
  windowDays: number;
  from: string;
  to: string;
  playersWithCombat: number;
  membersTotal: number;
  averages: ClanPublicAverages;
  roles: ClanPublicRoleSlice[];
  players: ClanPublicPlayerRow[];
  maps: ClanPublicMapRow[];
};

async function avgSessionSecForSteams(
  steamIds: string[],
  fromIso: Date,
  toIso: Date
): Promise<number> {
  const uniq = [...new Set(steamIds.filter(Boolean))];
  if (!uniq.length) return 0;
  const keys = [...PUBLIC_SERVER_KEYS, "PUB"] as string[];
  const rows = await prisma.$queryRaw<{ avg_sec: number | null }[]>`
    SELECT AVG(
      EXTRACT(EPOCH FROM (LEAST(COALESCE("leftAt", NOW()), ${toIso}) - "joinedAt"))
    )::float AS avg_sec
    FROM "SquadServerSession"
    WHERE "serverKey" IN (${Prisma.join(keys)})
      AND "steamId" IN (${Prisma.join(uniq)})
      AND "joinedAt" >= ${fromIso}
      AND "joinedAt" < ${toIso}
      AND ("leftAt" IS NULL OR "leftAt" > "joinedAt")
  `;
  const v = Number(rows[0]?.avg_sec);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/** Main PB1 kit hours per clan member over rolling 30 MSK days. */
export async function publicMainRolesByUserIds(
  userIds: string[]
): Promise<
  Map<string, { kit: string; sec: number; nick: string }>
> {
  const out = new Map<string, { kit: string; sec: number; nick: string }>();
  const uniq = [...new Set(userIds.filter(Boolean))];
  if (!uniq.length) return out;

  const win = rollingClanPublicRoleWindow();
  const bounds = mskRangeBoundsUtc(win.from, win.to);
  if (!bounds) return out;

  const users = await prisma.user.findMany({
    where: { id: { in: uniq } },
    select: { id: true, steamId: true, nick: true, steamName: true },
  });
  if (!users.length) return out;

  const steamIds = users
    .map((u) => normalizeSteamId(u.steamId || ""))
    .filter(Boolean) as string[];
  const idBySteam = new Map(
    users
      .map((u) => {
        const sid = normalizeSteamId(u.steamId || "");
        return sid ? ([sid, u.id] as const) : null;
      })
      .filter((x): x is readonly [string, string] => Boolean(x))
  );
  const memberIds = new Set(users.map((u) => u.id));
  const nickById = new Map(
    users.map((u) => [u.id, (u.nick || u.steamName || "игрок").trim()])
  );
  const keys = [...PUBLIC_SERVER_KEYS, "PUB"] as string[];
  const whoSql = steamIds.length
    ? Prisma.sql`("userId" IN (${Prisma.join(uniq)}) OR "steamId" IN (${Prisma.join(steamIds)}))`
    : Prisma.sql`"userId" IN (${Prisma.join(uniq)})`;

  const rows = await prisma.$queryRaw<
    { uid: string | null; sid: string | null; kit: string; sec: bigint }[]
  >`
    WITH ev AS (
      SELECT
        "userId" AS uid,
        "steamId" AS sid,
        kit,
        "spawnedAt",
        LEAD("spawnedAt") OVER (
          PARTITION BY COALESCE("userId", "steamId"), "serverKey"
          ORDER BY "spawnedAt", "id"
        ) AS nxt
      FROM "SquadRoleEvent"
      WHERE "serverKey" IN (${Prisma.join(keys)})
        AND "spawnedAt" >= ${bounds.gte}
        AND "spawnedAt" < ${bounds.lt}
        AND ${whoSql}
    )
    SELECT uid, sid, kit,
      SUM(LEAST(
        2700,
        GREATEST(0, EXTRACT(EPOCH FROM (
          LEAST(
            COALESCE(nxt, "spawnedAt" + INTERVAL '15 minutes'),
            "spawnedAt" + INTERVAL '45 minutes'
          ) - "spawnedAt"
        )))
      ))::bigint AS sec
    FROM ev
    GROUP BY uid, sid, kit
  `;

  const byUser = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const userId =
      row.uid && memberIds.has(row.uid)
        ? row.uid
        : row.sid
          ? idBySteam.get(normalizeSteamId(row.sid) || "") || ""
          : "";
    if (!userId) continue;
    const kit = String(canonKitName(row.kit) || "").trim();
    const sec = Number(row.sec) || 0;
    if (!kit || sec <= 0) continue;
    let kits = byUser.get(userId);
    if (!kits) {
      kits = new Map();
      byUser.set(userId, kits);
    }
    kits.set(kit, (kits.get(kit) || 0) + sec);
  }

  for (const [userId, kits] of byUser) {
    let bestKit = "";
    let bestSec = -1;
    for (const [kit, sec] of kits) {
      if (
        sec > bestSec ||
        (sec === bestSec && kit.localeCompare(bestKit, "ru") < 0)
      ) {
        bestKit = kit;
        bestSec = sec;
      }
    }
    if (!bestKit || bestSec <= 0) continue;
    out.set(userId, {
      kit: bestKit,
      sec: bestSec,
      nick: nickById.get(userId) || "игрок",
    });
  }
  return out;
}

async function buildClanMapStats(
  memberNicks: string[]
): Promise<ClanPublicMapRow[]> {
  const want = new Set(memberNicks.map(nickKey).filter(Boolean));
  if (!want.size) return [];

  // Reuse combat bundles via rating table path — load ladder matches lightly
  const { loadPublicRpLadder } = await import("@/lib/publicRp");
  const ledger = await loadPublicRpLadder();
  if (!ledger?.matches?.length || !ledger.players) return [];

  type Pm = { id: string; won?: boolean | null };
  // Per match: how many clan members played / how many were on the winning side.
  // Clan win = more members won than lost (avoids inflating WR when BB sits on both teams).
  const presence = new Map<string, { members: number; winners: number }>();

  for (const p of Object.values(ledger.players)) {
    const nick = String(p.nick || "").trim();
    const k = nickKey(nick);
    if (!k || !want.has(k)) continue;
    for (const m of (p.matches || []) as Pm[]) {
      if (!m?.id) continue;
      const cur = presence.get(m.id) || { members: 0, winners: 0 };
      cur.members += 1;
      if (m.won === true) cur.winners += 1;
      presence.set(m.id, cur);
    }
  }

  const byMap = new Map<string, { games: number; wins: number }>();
  for (const m of ledger.matches) {
    const hit = presence.get(m.id);
    if (!hit || hit.members <= 0) continue;
    const map = String((m as { map?: string }).map || "").trim() || "—";
    const row = byMap.get(map) || { games: 0, wins: 0 };
    row.games += 1;
    const losers = hit.members - hit.winners;
    if (hit.winners > losers) row.wins += 1;
    byMap.set(map, row);
  }

  return [...byMap.entries()]
    .map(([map, v]) => ({
      map,
      games: v.games,
      wins: v.wins,
      winPct: v.games > 0 ? Math.round((1000 * v.wins) / v.games) / 10 : 0,
    }))
    // Default: most games first
    .sort((a, b) => b.games - a.games || b.winPct - a.winPct);
}

export async function buildClanPublicStats(opts: {
  clanId: string;
  tag: string;
}): Promise<ClanPublicStats> {
  const win = rollingClanPublicRoleWindow();
  const bounds = mskRangeBoundsUtc(win.from, win.to);
  const tag = normalizeClanTag(opts.tag) || opts.tag;

  const members = await prisma.clanMember.findMany({
    where: { clanId: opts.clanId },
    select: {
      user: {
        select: {
          id: true,
          steamId: true,
          nick: true,
          steamName: true,
        },
      },
    },
  });

  const userIds = members.map((m) => m.user.id);
  const steamIds = members
    .map((m) => m.user.steamId)
    .filter((s): s is string => Boolean(s));
  const memberNicks = members
    .map((m) => m.user.nick || m.user.steamName || "")
    .filter(Boolean);

  // Full public table (not tag-filtered) — match by Steam/nick/collision
  const [table, rolesByUser, sessionSec] = await Promise.all([
    buildPublicRatingTable(5000, ""),
    publicMainRolesByUserIds(userIds),
    bounds
      ? avgSessionSecForSteams(steamIds, bounds.gte, bounds.lt)
      : Promise.resolve(0),
  ]);

  const combatByNick = new Map<string, PublicCombatRow>();
  const combatBySteam = new Map<string, PublicCombatRow>();
  for (const r of table.rows) {
    const k = nickKey(r.nick);
    if (k) {
      const prev = combatByNick.get(k);
      if (!prev || r.games > prev.games) combatByNick.set(k, r);
    }
    if (r.steamId) {
      const prev = combatBySteam.get(r.steamId);
      if (!prev || r.games > prev.games) combatBySteam.set(r.steamId, r);
    }
  }

  function combatForMember(m: {
    nick: string | null;
    steamName: string | null;
    steamId: string | null;
  }): PublicCombatRow | null {
    if (m.steamId && combatBySteam.has(m.steamId)) {
      return combatBySteam.get(m.steamId)!;
    }
    const siteNick = (m.nick || m.steamName || "").trim();
    if (!siteNick) return null;
    const col = collisionBySiteNick(siteNick);
    const lookup = publicRpLookupNick(siteNick, m.steamId || col?.steamId);
    const keys = [nickKey(lookup), nickKey(siteNick), nickKey(col?.publicNick || "")];
    for (const k of keys) {
      if (k && combatByNick.has(k)) return combatByNick.get(k)!;
    }
    return null;
  }

  type MemberCombat = {
    nick: string;
    steamId: string | null;
    row: PublicCombatRow | null;
  };
  const memberCombat: MemberCombat[] = members.map((m) => {
    const nick = (m.user.nick || m.user.steamName || "игрок").trim();
    return {
      nick,
      steamId: m.user.steamId,
      row: combatForMember(m.user),
    };
  });

  const playersCombat = memberCombat
    .map((m) => m.row)
    .filter((r): r is PublicCombatRow => Boolean(r && r.games > 0));

  const n = playersCombat.length;
  const sum = (fn: (r: PublicCombatRow) => number) =>
    playersCombat.reduce((a, r) => a + fn(r), 0);
  const avg = (fn: (r: PublicCombatRow) => number) =>
    n ? Math.round((10 * sum(fn)) / n) / 10 : 0;

  const winrates = playersCombat
    .map((r) => r.winPct)
    .filter((v): v is number => v != null);
  const avgWinrate = winrates.length
    ? Math.round((10 * winrates.reduce((a, b) => a + b, 0)) / winrates.length) /
      10
    : null;

  const averages: ClanPublicAverages = {
    avgKills: avg((r) => (r.games ? r.kills / r.games : 0)),
    avgNok: avg((r) => (r.games ? r.nok / r.games : 0)),
    avgRes: avg((r) => (r.games ? r.res / r.games : 0)),
    avgDeaths: avg((r) => (r.games ? r.deaths / r.games : 0)),
    avgKd: avg((r) => r.kd),
    avgWinrate,
    avgSessionLabel: fmtSession(sessionSec),
    avgVehicleKills: avg((r) => (r.games ? r.vehicleKills / r.games : 0)),
    mvpMedicTotal: sum((r) => r.mvpMedic),
    mvpKillerTotal: sum((r) => r.mvpKiller),
  };

  const roleBuckets = new Map<
    string,
    { sec: number; members: ClanPublicRolePlayer[] }
  >();
  for (const [userId, row] of rolesByUser) {
    const bucket = roleBuckets.get(row.kit) || { sec: 0, members: [] };
    bucket.sec += row.sec;
    bucket.members.push({
      nick: row.nick,
      userId,
      hours: Math.round((row.sec / 3600) * 10) / 10,
      hoursLabel: fmtHours(row.sec),
      sec: row.sec,
    });
    roleBuckets.set(row.kit, bucket);
  }
  const rolesAll: ClanPublicRoleSlice[] = [...roleBuckets.entries()]
    .map(([kit, b]) => {
      b.members.sort((a, c) => c.sec - a.sec || a.nick.localeCompare(c.nick, "ru"));
      return {
        kit,
        players: b.members.length,
        hours: Math.round((b.sec / 3600) * 10) / 10,
        hoursLabel: fmtHours(b.sec),
        pct: 0,
        members: b.members,
      };
    })
    // Popular = most players with this main role, then hours
    .sort(
      (a, b) =>
        b.players - a.players ||
        b.hours - a.hours ||
        a.kit.localeCompare(b.kit, "ru")
    );
  const rolesPopular = rolesAll.slice(0, POPULAR_ROLE_LIMIT);
  const popularSec = rolesPopular.reduce(
    (a, r) => a + r.members.reduce((s, m) => s + m.sec, 0),
    0
  );
  const roles: ClanPublicRoleSlice[] = rolesPopular.map((r) => {
    const sec = r.members.reduce((s, m) => s + m.sec, 0);
    return {
      ...r,
      pct: popularSec ? Math.round((1000 * sec) / popularSec) / 10 : 0,
    };
  });

  // Every clan member — siphon stats or zeros
  const players: ClanPublicPlayerRow[] = memberCombat
    .map((m) => {
      const r = m.row;
      return {
        nick: m.nick,
        steamId: m.steamId || r?.steamId || null,
        nok: r?.nok || 0,
        kills: r?.kills || 0,
        deaths: r?.deaths || 0,
        res: r?.res || 0,
        kd: r?.kd || 0,
        winPct: r?.winPct ?? null,
        games: r?.games || 0,
        mvpKiller: r?.mvpKiller || 0,
        mvpMedic: r?.mvpMedic || 0,
      };
    })
    .sort(
      (a, b) =>
        b.games - a.games ||
        b.kills - a.kills ||
        a.nick.localeCompare(b.nick, "ru")
    );

  const lookupNicks = memberCombat.flatMap((m) => {
    const site = m.nick;
    const col = collisionBySiteNick(site);
    const lookup = publicRpLookupNick(site, m.steamId || col?.steamId);
    return [site, lookup, col?.publicNick || ""].filter(Boolean);
  });
  const maps = await buildClanMapStats(lookupNicks);

  return {
    windowDays: win.days,
    from: win.from,
    to: win.to,
    playersWithCombat: playersCombat.length,
    membersTotal: members.length,
    averages,
    roles,
    players,
    maps,
  };
}
