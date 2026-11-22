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
  const presence = new Map<string, { any: boolean; won: boolean }>();

  for (const p of Object.values(ledger.players)) {
    const nick = String(p.nick || "").trim();
    const k = nickKey(nick);
    if (!k || !want.has(k)) continue;
    for (const m of (p.matches || []) as Pm[]) {
      if (!m?.id) continue;
      const cur = presence.get(m.id) || { any: false, won: false };
      cur.any = true;
      if (m.won === true) cur.won = true;
      presence.set(m.id, cur);
    }
  }

  const byMap = new Map<string, { games: number; wins: number }>();
  for (const m of ledger.matches) {
    const hit = presence.get(m.id);
    if (!hit?.any) continue;
    const map = String((m as { map?: string }).map || "").trim() || "—";
    const row = byMap.get(map) || { games: 0, wins: 0 };
    row.games += 1;
    if (hit.won) row.wins += 1;
    byMap.set(map, row);
  }

  return [...byMap.entries()]
    .map(([map, v]) => ({
      map,
      games: v.games,
      wins: v.wins,
      winPct: v.games > 0 ? Math.round((1000 * v.wins) / v.games) / 10 : 0,
    }))
    .sort((a, b) => b.winPct - a.winPct || b.games - a.games);
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

  const [table, rolesByUser, sessionSec] = await Promise.all([
    buildPublicRatingTable(2000, tag),
    publicMainRolesByUserIds(userIds),
    bounds
      ? avgSessionSecForSteams(steamIds, bounds.gte, bounds.lt)
      : Promise.resolve(0),
  ]);

  // Prefer site membership filter — rating table clan tag can lag
  const nickSet = new Set(memberNicks.map(nickKey));
  const combatRows: PublicCombatRow[] = table.rows.filter(
    (r) => nickSet.has(nickKey(r.nick)) || (tag && r.clan.toUpperCase() === tag.toUpperCase())
  );

  // Dedupe by nick
  const byNick = new Map<string, PublicCombatRow>();
  for (const r of combatRows) {
    const k = nickKey(r.nick);
    if (!k) continue;
    const prev = byNick.get(k);
    if (!prev || r.games > prev.games) byNick.set(k, r);
  }
  const playersCombat = [...byNick.values()];

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
  const totalRoleSec = [...roleBuckets.values()].reduce((a, b) => a + b.sec, 0);
  const roles: ClanPublicRoleSlice[] = [...roleBuckets.entries()]
    .map(([kit, b]) => {
      b.members.sort((a, c) => c.sec - a.sec || a.nick.localeCompare(c.nick, "ru"));
      return {
        kit,
        players: b.members.length,
        hours: Math.round((b.sec / 3600) * 10) / 10,
        hoursLabel: fmtHours(b.sec),
        pct: totalRoleSec
          ? Math.round((1000 * b.sec) / totalRoleSec) / 10
          : 0,
        members: b.members,
      };
    })
    .sort((a, b) => b.hours - a.hours || a.kit.localeCompare(b.kit, "ru"));

  const players: ClanPublicPlayerRow[] = playersCombat
    .map((r) => ({
      nick: r.nick,
      steamId: r.steamId,
      nok: r.nok,
      kills: r.kills,
      deaths: r.deaths,
      res: r.res,
      kd: r.kd,
      winPct: r.winPct,
      games: r.games,
      mvpKiller: r.mvpKiller,
      mvpMedic: r.mvpMedic,
    }))
    .sort((a, b) => b.kills - a.kills || a.nick.localeCompare(b.nick, "ru"));

  const maps = await buildClanMapStats(memberNicks);

  return {
    windowDays: win.days,
    from: win.from,
    to: win.to,
    playersWithCombat: players.length,
    membersTotal: members.length,
    averages,
    roles,
    players,
    maps,
  };
}
