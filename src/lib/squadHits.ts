import { prisma } from "@/lib/prisma";
import { normalizeEosId, normalizeSteamId } from "@/lib/squadSessions";

export type SquadHitIngestEvent = {
  type: "hit";
  steamId?: string | null;
  eosId?: string | null;
  victimEos?: string | null;
  zone?: string | null;
  bone?: string | null;
  damage?: number | string | null;
  weapon?: string | null;
  /** ISO-8601 UTC */
  at: string;
  serverKey?: string;
};

export type HitBoneCounts = Record<string, number>;

/** Skip empty / None bones — not useful on the silhouette. */
export function normalizeBone(raw: string | null | undefined): string | null {
  const b = (raw || "").trim();
  if (!b) return null;
  if (b.toLowerCase() === "none") return null;
  return b;
}

export function normalizeZone(raw: string | null | undefined): string {
  const z = (raw || "").trim();
  if (!z) return "Limb";
  const low = z.toLowerCase();
  if (low === "head") return "Head";
  if (low === "torso") return "Torso";
  if (low === "limb") return "Limb";
  return z;
}

export function hitEventKey(opts: {
  serverKey: string;
  hitAt: Date;
  attackerKey: string;
  victimEos: string;
  bone: string;
  damage: number | null;
  weapon: string;
}): string {
  const dmg =
    opts.damage == null || Number.isNaN(opts.damage)
      ? ""
      : String(Math.round(opts.damage * 1000) / 1000);
  return [
    opts.serverKey,
    opts.hitAt.getTime(),
    opts.attackerKey,
    opts.victimEos || "",
    opts.bone,
    dmg,
    opts.weapon || "",
  ].join("|");
}

export function parseDamage(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n)) return null;
  return n;
}

/** Lifetime bone counts for profile hitmap (attacker perspective). */
export type BonesForUserOpts = {
  /** Календарный день Europe/Moscow YYYY-MM-DD; без — всё время */
  dayYmd?: string | null;
  /** Диапазон МСК YYYY-MM-DD (включительно); перекрывает dayYmd */
  fromYmd?: string | null;
  toYmd?: string | null;
};

/** Границы суток МСК → UTC [gte, lt). */
export function mskDayBoundsUtc(ymd: string): { gte: Date; lt: Date } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  // 00:00 MSK = 21:00 UTC предыдущего календарного UTC-дня относительно UTC midnight
  const gte = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0) - 3 * 3600_000);
  const lt = new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0, 0) - 3 * 3600_000);
  if (Number.isNaN(gte.getTime()) || Number.isNaN(lt.getTime())) return null;
  return { gte, lt };
}

/** Диапазон МСК [from..to] включительно → UTC [gte, lt). */
export function mskRangeBoundsUtc(
  fromYmd?: string | null,
  toYmd?: string | null
): { gte?: Date; lt?: Date } | null {
  const from = fromYmd?.trim() || null;
  const to = toYmd?.trim() || null;
  if (!from && !to) return null;
  const gte = from ? mskDayBoundsUtc(from)?.gte : undefined;
  const lt = to ? mskDayBoundsUtc(to)?.lt : undefined;
  if (from && !gte) return null;
  if (to && !lt) return null;
  return { gte, lt };
}

export function formatMskYmd(d: Date): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // en-CA → YYYY-MM-DD
  return fmt.format(d);
}

async function bonesWhere(
  identity: { userId?: string | null; steamIds?: string[] },
  opts: BonesForUserOpts = {}
) {
  const day = opts.dayYmd?.trim() || null;
  const range = mskRangeBoundsUtc(opts.fromYmd, opts.toYmd);
  const dayBounds = !range && day ? mskDayBoundsUtc(day) : null;
  const hitAt =
    range && (range.gte || range.lt)
      ? {
          ...(range.gte ? { gte: range.gte } : {}),
          ...(range.lt ? { lt: range.lt } : {}),
        }
      : dayBounds
        ? { gte: dayBounds.gte, lt: dayBounds.lt }
        : undefined;
  const steamIds = (identity.steamIds || []).filter(Boolean);
  const who = identity.userId
    ? { userId: identity.userId }
    : steamIds.length
      ? { steamId: { in: steamIds } }
      : null;
  if (!who) return null;
  return {
    ...who,
    NOT: { bone: "None" as const },
    ...(hitAt ? { hitAt } : {}),
  };
}

export async function bonesForUser(
  userId: string,
  opts: BonesForUserOpts = {}
): Promise<{ bones: HitBoneCounts; total: number; lastBone: string | null }> {
  const where = await bonesWhere({ userId }, opts);
  if (!where) return { bones: {}, total: 0, lastBone: null };

  const [rows, last] = await Promise.all([
    prisma.squadHitEvent.groupBy({
      by: ["bone"],
      where,
      _count: { _all: true },
    }),
    prisma.squadHitEvent.findFirst({
      where,
      orderBy: [{ hitAt: "desc" }, { createdAt: "desc" }],
      select: { bone: true },
    }),
  ]);
  const bones: HitBoneCounts = {};
  let total = 0;
  for (const r of rows) {
    const n = r._count._all;
    bones[r.bone] = n;
    total += n;
  }
  const lastBone = last?.bone && last.bone !== "None" ? last.bone : null;
  return { bones, total, lastBone };
}

/** Попадания по Steam (соперник без аккаунта). */
export async function bonesForSteamIds(
  steamIds: string[],
  opts: BonesForUserOpts = {}
): Promise<{ bones: HitBoneCounts; total: number; lastBone: string | null }> {
  const ids = [...new Set(steamIds.filter(Boolean))];
  if (!ids.length) return { bones: {}, total: 0, lastBone: null };
  const where = await bonesWhere({ steamIds: ids }, opts);
  if (!where) return { bones: {}, total: 0, lastBone: null };

  const [rows, last] = await Promise.all([
    prisma.squadHitEvent.groupBy({
      by: ["bone"],
      where,
      _count: { _all: true },
    }),
    prisma.squadHitEvent.findFirst({
      where,
      orderBy: [{ hitAt: "desc" }, { createdAt: "desc" }],
      select: { bone: true },
    }),
  ]);
  const bones: HitBoneCounts = {};
  let total = 0;
  for (const r of rows) {
    const n = r._count._all;
    bones[r.bone] = n;
    total += n;
  }
  const lastBone = last?.bone && last.bone !== "None" ? last.bone : null;
  return { bones, total, lastBone };
}

export type HitmapMatchOptionBuilt = {
  matchId: string;
  dateLabel: string;
  map: string;
  timeLabel?: string;
  ticketsA?: number | null;
  ticketsB?: number | null;
  won?: boolean | null;
  kind: "train" | "cw";
};

type HitWindow = {
  fromYmd: string;
  toYmd: string;
  gte?: Date;
  lt?: Date;
};

function mskWallToUtc(ymd: string, secOfDay: number): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(
    Date.UTC(y, m - 1, d, 0, 0, 0, 0) - 3 * 3600_000 + secOfDay * 1000
  );
}

function parseHmToSec(raw: string): number | null {
  const t = String(raw || "").trim();
  if (!/^\d{1,2}:\d{2}(:\d{2})?$/.test(t)) return null;
  const [hh, mm, ss] = t.split(":").map(Number);
  return (hh || 0) * 3600 + (mm || 0) * 60 + (ss || 0);
}

function clusterHitRanges(
  hitTimes: number[],
  gapMs = 12 * 60_000
): Array<{ gte: number; lt: number }> {
  if (!hitTimes.length) return [];
  const sorted = [...hitTimes].sort((a, b) => a - b);
  const clusters: number[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const t = sorted[i];
    const cur = clusters[clusters.length - 1];
    if (t - cur[cur.length - 1] > gapMs) clusters.push([t]);
    else cur.push(t);
  }
  return clusters.map((c) => ({
    gte: c[0] - 60_000,
    lt: c[c.length - 1] + 60_000,
  }));
}

async function loadCwMatchMeta(matchId: string): Promise<{
  id: string;
  ymd: string;
  map: string;
  opp: string;
  meeting: string;
  r1: string;
  r2: string;
  status: string;
} | null> {
  const id = String(matchId || "").trim();
  if (!id) return null;
  const { loadKvJsonCached } = await import("@/lib/kvLocal");
  const index = await loadKvJsonCached<{
    months?: { year?: number; month?: number; url?: string }[];
  }>("data/index.json");
  for (const m of index?.months || []) {
    if (!m.url || !m.year || !m.month) continue;
    const monthData = await loadKvJsonCached<{
      matches?: {
        id?: string;
        day?: number;
        map?: string;
        opp?: string;
        meeting?: string;
        r1?: string;
        r2?: string;
        status?: string;
        timeMsk?: string;
      }[];
    }>(m.url);
    for (const match of monthData?.matches || []) {
      if (String(match.id || "") !== id) continue;
      if (match.day == null) continue;
      const ymd = `${m.year}-${String(m.month).padStart(2, "0")}-${String(match.day).padStart(2, "0")}`;
      return {
        id,
        ymd,
        map: match.map || "—",
        opp: match.opp || "—",
        meeting: match.meeting || "—",
        r1: match.r1 || "—",
        r2: match.r2 || "—",
        status: String(match.status || ""),
      };
    }
  }
  return null;
}

/** Окно матча: train RP-ledger, CW календарь, hits:ymd, или id#r1 / id#r2. */
export async function resolveHitMatchWindow(
  matchId: string
): Promise<HitWindow | null> {
  const raw = String(matchId || "").trim();
  if (!raw) return null;

  // synthetic day / round from hit clusters
  const syn = raw.match(/^hits:(\d{4}-\d{2}-\d{2})(?::(r[12]))?$/i);
  if (syn) {
    const ymd = syn[1];
    const round = syn[2]?.toLowerCase() || null;
    const day = mskDayBoundsUtc(ymd);
    if (!day) return null;
    if (!round) return { fromYmd: ymd, toYmd: ymd, gte: day.gte, lt: day.lt };
    if (round === "r1") {
      return {
        fromYmd: ymd,
        toYmd: ymd,
        gte: mskWallToUtc(ymd, 19 * 3600),
        lt: mskWallToUtc(ymd, 21 * 3600 + 15 * 60),
      };
    }
    return {
      fromYmd: ymd,
      toYmd: ymd,
      gte: mskWallToUtc(ymd, 21 * 3600 + 10 * 60),
      lt: mskWallToUtc(ymd, 23 * 3600 + 30 * 60),
    };
  }

  const roundHit = raw.match(/^(.*)#(r[12])$/i);
  const baseId = roundHit ? roundHit[1] : raw;
  const round = roundHit ? roundHit[2].toLowerCase() : null;

  const { matchHitWindow } = await import("@/lib/playerCompare");
  const trainWin = await matchHitWindow(baseId);
  if (trainWin && !round) return trainWin;

  const cw = await loadCwMatchMeta(baseId);
  if (cw) {
    if (!round) {
      return {
        fromYmd: cw.ymd,
        toYmd: cw.ymd,
        gte: mskWallToUtc(cw.ymd, 19 * 3600),
        lt: mskWallToUtc(cw.ymd, 23 * 3600 + 30 * 60),
      };
    }
    if (round === "r1") {
      return {
        fromYmd: cw.ymd,
        toYmd: cw.ymd,
        gte: mskWallToUtc(cw.ymd, 19 * 3600),
        lt: mskWallToUtc(cw.ymd, 21 * 3600 + 15 * 60),
      };
    }
    return {
      fromYmd: cw.ymd,
      toYmd: cw.ymd,
      gte: mskWallToUtc(cw.ymd, 21 * 3600 + 10 * 60),
      lt: mskWallToUtc(cw.ymd, 23 * 3600 + 30 * 60),
    };
  }

  if (trainWin) return trainWin;
  return null;
}

async function bonesInWindow(
  identity: { userId?: string | null; steamIds?: string[] },
  win: HitWindow,
  matchId: string
): Promise<{
  bones: HitBoneCounts;
  total: number;
  lastBone: string | null;
  matchId: string;
} | null> {
  const steamIds = (identity.steamIds || []).filter(Boolean);
  const who = identity.userId
    ? { userId: identity.userId }
    : steamIds.length
      ? { steamId: { in: steamIds } }
      : null;
  if (!who) return null;

  if (win.gte && win.lt) {
    const where = {
      ...who,
      hitAt: { gte: win.gte, lt: win.lt },
      NOT: { bone: "None" as const },
    };
    const [rows, last] = await Promise.all([
      prisma.squadHitEvent.groupBy({
        by: ["bone"],
        where,
        _count: { _all: true },
      }),
      prisma.squadHitEvent.findFirst({
        where,
        orderBy: [{ hitAt: "desc" }, { createdAt: "desc" }],
        select: { bone: true },
      }),
    ]);
    const bones: HitBoneCounts = {};
    let total = 0;
    for (const r of rows) {
      if (!r.bone || r.bone === "None") continue;
      bones[r.bone] = r._count._all;
      total += r._count._all;
    }
    return {
      bones,
      total,
      lastBone: last?.bone && last.bone !== "None" ? last.bone : null,
      matchId,
    };
  }

  if (identity.userId) {
    const hits = await bonesForUser(identity.userId, {
      fromYmd: win.fromYmd,
      toYmd: win.toYmd,
    });
    return { ...hits, matchId };
  }
  const hits = await bonesForSteamIds(steamIds, {
    fromYmd: win.fromYmd,
    toYmd: win.toYmd,
  });
  return { ...hits, matchId };
}

async function resolveRoundWindowFromClusters(
  identity: { userId?: string | null; steamIds?: string[] },
  matchId: string
): Promise<HitWindow | null> {
  const roundHit = String(matchId || "").trim().match(/^(.*)#(r[12])$/i);
  const syn = String(matchId || "")
    .trim()
    .match(/^hits:(\d{4}-\d{2}-\d{2}):(r[12])$/i);
  if (!roundHit && !syn) return null;

  let ymd = "";
  let round = "";
  if (syn) {
    ymd = syn[1];
    round = syn[2].toLowerCase();
  } else if (roundHit) {
    round = roundHit[2].toLowerCase();
    const cw = await loadCwMatchMeta(roundHit[1]);
    if (cw) ymd = cw.ymd;
    else {
      const { matchHitWindow } = await import("@/lib/playerCompare");
      const tw = await matchHitWindow(roundHit[1]);
      if (tw?.fromYmd) ymd = tw.fromYmd;
    }
  }
  if (!ymd || !round) return null;

  const eveningGte = mskWallToUtc(ymd, 18 * 3600).getTime();
  const eveningLt = mskWallToUtc(ymd, 24 * 3600 - 1).getTime();
  const hitTimes = (await loadHitTimes(identity)).filter(
    (t) => t >= eveningGte && t < eveningLt
  );
  const clusters = clusterHitRanges(
    hitTimes.length
      ? hitTimes
      : (await loadHitTimes(identity)).filter((t) => {
          const day = mskDayBoundsUtc(ymd);
          return Boolean(day && t >= day.gte.getTime() && t < day.lt.getTime());
        })
  );
  if (!clusters.length) {
    return resolveHitMatchWindow(matchId);
  }
  const idx = round === "r1" ? 0 : Math.min(1, clusters.length - 1);
  const c = clusters[idx];
  return {
    fromYmd: ymd,
    toYmd: ymd,
    gte: new Date(c.gte),
    lt: new Date(c.lt),
  };
}

/** Попадания за окно матча (train ledger / CW / #r1|#r2). */
export async function bonesForUserMatch(
  userId: string,
  matchId: string
): Promise<{
  bones: HitBoneCounts;
  total: number;
  lastBone: string | null;
  matchId: string;
} | null> {
  const id = String(matchId || "").trim();
  if (!id) return null;
  const win =
    (await resolveRoundWindowFromClusters({ userId }, id)) ||
    (await resolveHitMatchWindow(id));
  if (!win) return null;
  return bonesInWindow({ userId }, win, id);
}

export async function bonesForSteamMatch(
  steamIds: string[],
  matchId: string
): Promise<{
  bones: HitBoneCounts;
  total: number;
  lastBone: string | null;
  matchId: string;
} | null> {
  const id = String(matchId || "").trim();
  const ids = [
    ...new Set(
      steamIds.map((s) => normalizeSteamId(s) || s).filter(Boolean)
    ),
  ];
  if (!id || !ids.length) return null;
  const win =
    (await resolveRoundWindowFromClusters({ steamIds: ids }, id)) ||
    (await resolveHitMatchWindow(id));
  if (!win) return null;
  return bonesInWindow({ steamIds: ids }, win, id);
}

async function loadHitTimes(opts: {
  userId?: string | null;
  steamIds?: string[];
}): Promise<number[]> {
  const steamIds = [
    ...new Set(
      (opts.steamIds || [])
        .map((s) => normalizeSteamId(s) || s)
        .filter(Boolean)
    ),
  ];
  const or: Array<{ userId?: string; steamId?: { in: string[] } }> = [];
  if (opts.userId) or.push({ userId: opts.userId });
  if (steamIds.length) or.push({ steamId: { in: steamIds } });
  if (!or.length) return [];

  const hits = await prisma.squadHitEvent.findMany({
    where: { OR: or, NOT: { bone: "None" } },
    select: { hitAt: true },
    orderBy: { hitAt: "asc" },
  });
  return hits.map((h) => h.hitAt.getTime());
}

function hasHitInRange(
  hitTimes: number[],
  gteMs: number,
  ltMs: number
): boolean {
  let lo = 0;
  let hi = hitTimes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (hitTimes[mid] < gteMs) lo = mid + 1;
    else hi = mid;
  }
  return lo < hitTimes.length && hitTimes[lo] < ltMs;
}

function hitsInRange(hitTimes: number[], gteMs: number, ltMs: number): number[] {
  return hitTimes.filter((t) => t >= gteMs && t < ltMs);
}

/**
 * Оставляет только матчи, где у игрока есть логи попаданий с костью
 * (BBHitZone). Матчи без точных хитов в список «Матчи» не попадают.
 */
export async function filterTrainHistoryWithHitLogs<
  T extends { matchId: string },
>(userId: string, history: T[]): Promise<T[]> {
  if (!history.length) return [];
  const hitTimes = await loadHitTimes({ userId });
  if (!hitTimes.length) return [];

  const { loadRpLedger } = await import("@/lib/trainRp");
  const ledger = await loadRpLedger();
  if (!ledger?.matches?.length) return [];

  const byId = new Map(ledger.matches.map((m) => [m.id, m]));
  const out: T[] = [];

  for (const row of history) {
    const match = byId.get(row.matchId);
    if (!match?.date || !/^\d{4}-\d{2}-\d{2}$/.test(match.date)) continue;
    const ymd = match.date;
    const times = (match.events || [])
      .map((e) => String(e.time || "").trim())
      .map((t) => parseHmToSec(t))
      .filter((n): n is number => n != null)
      .sort((a, b) => a - b);

    if (times.length >= 2) {
      const pad = 90;
      const startSec = Math.max(0, times[0] - pad);
      const endSec = Math.min(24 * 3600 - 1, times[times.length - 1] + pad);
      const gte = mskWallToUtc(ymd, startSec);
      const lt = mskWallToUtc(ymd, endSec + 1);
      if (hasHitInRange(hitTimes, gte.getTime(), lt.getTime())) out.push(row);
      continue;
    }

    const dayBounds = mskDayBoundsUtc(ymd);
    if (
      dayBounds &&
      hasHitInRange(hitTimes, dayBounds.gte.getTime(), dayBounds.lt.getTime())
    ) {
      out.push(row);
    }
  }

  return out;
}

/**
 * Список матчей/раундов для пикера хитмапа:
 * тренировки с хитами + КВ (если 2 кластера хитов вечером — R1 и R2).
 */
export async function buildHitmapMatchOptions(opts: {
  userId?: string | null;
  steamIds?: string[];
  nick?: string | null;
}): Promise<HitmapMatchOptionBuilt[]> {
  const userId = opts.userId || null;
  const steamIds = [
    ...new Set(
      (opts.steamIds || [])
        .map((s) => normalizeSteamId(s) || s)
        .filter(Boolean)
    ),
  ];
  const nick = (opts.nick || "").trim();
  const hitTimes = await loadHitTimes({ userId, steamIds });
  if (!hitTimes.length) return [];

  const out: HitmapMatchOptionBuilt[] = [];
  const seen = new Set<string>();

  // —— Training ——
  if (nick) {
    const { buildPlayerTrainMatchHistory } = await import("@/lib/homeTrainPwr");
    const trainHist = await buildPlayerTrainMatchHistory(nick).catch(() => []);
    const filtered = userId
      ? await filterTrainHistoryWithHitLogs(userId, trainHist)
      : await (async () => {
          // steam-only: reuse day/window check without userId filter helper
          const { loadRpLedger } = await import("@/lib/trainRp");
          const ledger = await loadRpLedger();
          const byId = new Map((ledger?.matches || []).map((m) => [m.id, m]));
          return trainHist.filter((row) => {
            const match = byId.get(row.matchId);
            if (!match?.date) return false;
            const times = (match.events || [])
              .map((e) => parseHmToSec(String(e.time || "")))
              .filter((n): n is number => n != null)
              .sort((a, b) => a - b);
            if (times.length >= 2) {
              const gte = mskWallToUtc(match.date, Math.max(0, times[0] - 90));
              const lt = mskWallToUtc(
                match.date,
                Math.min(24 * 3600 - 1, times[times.length - 1] + 91)
              );
              return hasHitInRange(hitTimes, gte.getTime(), lt.getTime());
            }
            const day = mskDayBoundsUtc(match.date);
            return Boolean(
              day &&
                hasHitInRange(hitTimes, day.gte.getTime(), day.lt.getTime())
            );
          });
        })();

    for (const m of filtered) {
      if (seen.has(m.matchId)) continue;
      seen.add(m.matchId);
      out.push({
        matchId: m.matchId,
        dateLabel: m.dateLabel,
        map: m.map,
        timeLabel: m.timeLabel,
        ticketsA: m.ticketsA,
        ticketsB: m.ticketsB,
        won: m.won,
        kind: "train",
      });
    }
  }

  // —— Clan wars (possibly split into R1/R2 by hit clusters) ——
  if (nick) {
    const { buildPlayerCwMatchHistory } = await import("@/lib/homeCwPwr");
    const cwHist = await buildPlayerCwMatchHistory(nick).catch(() => []);
    for (const m of cwHist) {
      const meta = await loadCwMatchMeta(m.matchId);
      if (!meta) continue;
      const eveningGte = mskWallToUtc(meta.ymd, 19 * 3600).getTime();
      const eveningLt = mskWallToUtc(meta.ymd, 23 * 3600 + 30 * 60).getTime();
      const inEve = hitsInRange(hitTimes, eveningGte, eveningLt);
      if (!inEve.length) {
        const day = mskDayBoundsUtc(meta.ymd);
        if (
          !day ||
          !hasHitInRange(hitTimes, day.gte.getTime(), day.lt.getTime())
        ) {
          continue;
        }
      }

      const clusters = clusterHitRanges(inEve.length ? inEve : hitsInRange(
        hitTimes,
        mskDayBoundsUtc(meta.ymd)!.gte.getTime(),
        mskDayBoundsUtc(meta.ymd)!.lt.getTime()
      ));

      const dateLabel = m.dateLabel;
      const parseTickets = (s: string): number | null => {
        const n = Number(String(s || "").replace(/[^\d-]/g, ""));
        return Number.isFinite(n) ? n : null;
      };

      if (clusters.length >= 2 && (m.r1 || m.r2)) {
        const rounds: Array<{
          id: string;
          label: string;
          ta: number | null;
          tb: number | null;
          cluster: { gte: number; lt: number };
        }> = [
          {
            id: `${m.matchId}#r1`,
            label: `R1 · ${m.map}`,
            ta: parseTickets(String(m.r1 || "").split(/[–\-:]/)[0] || ""),
            tb: parseTickets(String(m.r1 || "").split(/[–\-:]/)[1] || ""),
            cluster: clusters[0],
          },
          {
            id: `${m.matchId}#r2`,
            label: `R2 · ${m.map}`,
            ta: parseTickets(String(m.r2 || "").split(/[–\-:]/)[0] || ""),
            tb: parseTickets(String(m.r2 || "").split(/[–\-:]/)[1] || ""),
            cluster: clusters[Math.min(1, clusters.length - 1)],
          },
        ];
        for (const r of rounds) {
          if (!hasHitInRange(hitTimes, r.cluster.gte, r.cluster.lt)) continue;
          if (seen.has(r.id)) continue;
          seen.add(r.id);
          out.push({
            matchId: r.id,
            dateLabel,
            map: r.label,
            timeLabel: m.opp,
            ticketsA: r.ta,
            ticketsB: r.tb,
            won: m.won,
            kind: "cw",
          });
        }
      } else {
        if (seen.has(m.matchId)) continue;
        seen.add(m.matchId);
        const meeting = String(m.meeting || "");
        const parts = meeting.split(/[–\-:]/).map((x) => x.trim());
        out.push({
          matchId: m.matchId,
          dateLabel,
          map: `КВ · ${m.map}`,
          timeLabel: m.opp,
          ticketsA: parseTickets(parts[0] || ""),
          ticketsB: parseTickets(parts[1] || ""),
          won: m.won,
          kind: "cw",
        });
      }
    }
  }

  // Fallback: if still empty but hits exist — synthesize from hit-day clusters
  if (!out.length) {
    const byDay = new Map<string, number[]>();
    for (const t of hitTimes) {
      const ymd = formatMskYmd(new Date(t));
      if (!byDay.has(ymd)) byDay.set(ymd, []);
      byDay.get(ymd)!.push(t);
    }
    const days = [...byDay.keys()].sort((a, b) => b.localeCompare(a));
    for (const ymd of days.slice(0, 5)) {
      const times = byDay.get(ymd)!;
      const clusters = clusterHitRanges(times);
      const [y, mo, d] = ymd.split("-");
      const dateLabel = `${d}.${mo}.${y}`;
      if (clusters.length >= 2) {
        clusters.slice(0, 2).forEach((c, i) => {
          const id = `hits:${ymd}:r${i + 1}`;
          if (seen.has(id)) return;
          seen.add(id);
          out.push({
            matchId: id,
            dateLabel,
            map: `Раунд ${i + 1}`,
            timeLabel: "",
            won: null,
            kind: "train",
          });
        });
      } else {
        const id = `hits:${ymd}`;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({
          matchId: id,
          dateLabel,
          map: "Попадания за день",
          won: null,
          kind: "train",
        });
      }
    }
  }

  return out;
}

export type HitZonePct = {
  head: number;
  torso: number;
  limb: number;
};

/** Доли Head / Torso / Limb из счётчиков костей (0–100). */
export function zonePctFromBones(bones: HitBoneCounts): HitZonePct {
  let head = 0;
  let torso = 0;
  let limb = 0;
  for (const [bone, n] of Object.entries(bones || {})) {
    if (!n || bone === "None") continue;
    if (bone.includes("Head") || bone.includes("Neck")) head += n;
    else if (
      bone.includes("Spine") ||
      bone.includes("Pelvis") ||
      bone.includes("Clavicle")
    )
      torso += n;
    else limb += n;
  }
  const sum = head + torso + limb;
  if (sum <= 0) return { head: 0, torso: 0, limb: 0 };
  const round1 = (v: number) => Math.round((1000 * v) / sum) / 10;
  return {
    head: round1(head),
    torso: round1(torso),
    limb: round1(limb),
  };
}

/** Дни МСК, в которые были попадания (для подсветки в календаре). */
export async function hitDaysForUser(userId: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ d: Date }[]>`
    SELECT DISTINCT (
      (("hitAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow')::date
    ) AS d
    FROM "SquadHitEvent"
    WHERE "userId" = ${userId}
    ORDER BY d DESC
  `;
  return rows.map((r) => {
    const dt = r.d instanceof Date ? r.d : new Date(r.d);
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const day = String(dt.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  });
}

const HITMAP_BONE_ORDER = [
  "Bip01_Head",
  "Bip01_Neck",
  "Bip01_L_Clavicle",
  "Bip01_R_Clavicle",
  "Bip01_Spine2",
  "Bip01_Spine",
  "Bip01_Pelvis",
  "Bip01_L_UpperArm",
  "Bip01_R_UpperArm",
  "Bip01_L_Forearm",
  "Bip01_R_Forearm",
  "Bip01_L_Hand",
  "Bip01_R_Hand",
  "Bip01_L_Thigh",
  "Bip01_R_Thigh",
  "Bip01_L_Calf",
  "Bip01_R_Calf",
  "Bip01_L_Foot",
  "Bip01_R_Foot",
] as const;

function nickKey(nick: string): string {
  return nick.trim().toLowerCase().replace(/\s+/g, " ");
}

export type TierHitmapAvg = {
  tier: 1 | 2 | 3 | 4;
  label: string;
  players: number;
  /** сумма попаданий по тиру */
  totalHits: number;
  /** средний % по кости (равный вес игрока), 0–100 */
  bonePct: Record<string, number>;
  /** синтетические счётчики для отрисовки точек (из %) */
  bones: HitBoneCounts;
};

export type ClanHitmapAvg = {
  players: number;
  totalHits: number;
  /** средний % по кости (равный вес игрока), 0–100 */
  bonePct: Record<string, number>;
  /** синтетические счётчики для отрисовки (из %) */
  bones: HitBoneCounts;
};

/**
 * Средний «человечек» клана: берём всех игроков с хитами,
 * считаем % по костям у каждого, усредняем с равным весом.
 */
export async function hitmapAverageForClan(opts: {
  userIds?: string[];
  steamIds?: string[];
}): Promise<ClanHitmapAvg> {
  const userIds = [...new Set((opts.userIds || []).filter(Boolean))];
  const steamIds = [
    ...new Set(
      (opts.steamIds || [])
        .map((s) => normalizeSteamId(s) || s)
        .filter(Boolean)
    ),
  ];

  const empty: ClanHitmapAvg = {
    players: 0,
    totalHits: 0,
    bonePct: {},
    bones: {},
  };
  if (!userIds.length && !steamIds.length) return empty;

  const or: Array<{ userId?: { in: string[] }; steamId?: { in: string[] } }> =
    [];
  if (userIds.length) or.push({ userId: { in: userIds } });
  if (steamIds.length) or.push({ steamId: { in: steamIds } });

  const grouped = await prisma.squadHitEvent.groupBy({
    by: ["userId", "steamId", "bone"],
    where: {
      OR: or,
      NOT: { bone: "None" },
    },
    _count: { _all: true },
  });

  // ключ игрока: userId предпочтительнее steamId
  const byPlayer = new Map<string, HitBoneCounts>();
  for (const g of grouped) {
    if (!g.bone || g.bone === "None") continue;
    const key = g.userId
      ? `u:${g.userId}`
      : g.steamId
        ? `s:${g.steamId}`
        : "";
    if (!key) continue;
    // если есть userId — не дублируем тот же steam отдельной персоной
    if (g.userId && g.steamId) {
      /* ok */
    }
    const cur = byPlayer.get(key) || {};
    cur[g.bone] = (cur[g.bone] || 0) + g._count._all;
    byPlayer.set(key, cur);
  }

  // схлопнуть steam-only если тот же steam уже в userId-группе — сложно без join;
  // достаточно: для членов клана передаём userIds, для pending — steamIds без userId.

  const pctSum: Record<string, number> = {};
  let players = 0;
  let totalHits = 0;
  for (const bones of byPlayer.values()) {
    let sum = 0;
    for (const n of Object.values(bones)) sum += n;
    if (sum <= 0) continue;
    players += 1;
    totalHits += sum;
    for (const [bone, n] of Object.entries(bones)) {
      const p = (100 * n) / sum;
      pctSum[bone] = (pctSum[bone] || 0) + p;
    }
  }

  if (!players) return empty;

  const bonePct: Record<string, number> = {};
  const bones: HitBoneCounts = {};
  for (const [bone, sumPct] of Object.entries(pctSum)) {
    const avg = Math.round((sumPct / players) * 10) / 10;
    if (avg <= 0) continue;
    bonePct[bone] = avg;
    bones[bone] = Math.max(1, Math.round(avg));
  }

  return { players, totalHits, bonePct, bones };
}

/** Средние профили попаданий по тирам 1–4 (зарегистрированные с хитами). */
export async function hitmapAveragesByTier(): Promise<TierHitmapAvg[]> {
  const { loadTierIndex } = await import("@/lib/loadTierIndex");
  const tierIndex = await loadTierIndex();

  const users = await prisma.user.findMany({
    where: {
      profileComplete: true,
      nick: { not: null },
      squadHits: { some: {} },
    },
    select: { id: true, nick: true },
  });

  const grouped = await prisma.squadHitEvent.groupBy({
    by: ["userId", "bone"],
    where: {
      userId: { in: users.map((u) => u.id) },
      NOT: { bone: "None" },
    },
    _count: { _all: true },
  });

  const byUser = new Map<string, HitBoneCounts>();
  for (const g of grouped) {
    const uid = g.userId;
    if (!uid || !g.bone || g.bone === "None") continue;
    const cur = byUser.get(uid) || {};
    cur[g.bone] = g._count._all;
    byUser.set(uid, cur);
  }

  type Acc = {
    players: number;
    totalHits: number;
    pctSum: Record<string, number>;
  };
  const tiers: Record<1 | 2 | 3 | 4, Acc> = {
    1: { players: 0, totalHits: 0, pctSum: {} },
    2: { players: 0, totalHits: 0, pctSum: {} },
    3: { players: 0, totalHits: 0, pctSum: {} },
    4: { players: 0, totalHits: 0, pctSum: {} },
  };

  for (const u of users) {
    const bones = byUser.get(u.id);
    if (!bones) continue;
    let sum = 0;
    for (const n of Object.values(bones)) sum += n;
    if (sum <= 0) continue;
    const nick = (u.nick || "").trim();
    const tRaw = nick ? tierIndex.get(nickKey(nick)) : undefined;
    const tier: 1 | 2 | 3 | 4 = tRaw === 1 || tRaw === 2 || tRaw === 3 ? tRaw : 4;
    const acc = tiers[tier];
    acc.players += 1;
    acc.totalHits += sum;
    for (const bone of HITMAP_BONE_ORDER) {
      const n = bones[bone] || 0;
      const p = (100 * n) / sum;
      acc.pctSum[bone] = (acc.pctSum[bone] || 0) + p;
    }
    // unknown bones
    for (const [bone, n] of Object.entries(bones)) {
      if ((HITMAP_BONE_ORDER as readonly string[]).includes(bone)) continue;
      const p = (100 * n) / sum;
      acc.pctSum[bone] = (acc.pctSum[bone] || 0) + p;
    }
  }

  const labels: Record<1 | 2 | 3 | 4, string> = {
    1: "Тир 1",
    2: "Тир 2",
    3: "Тир 3",
    4: "Тир 4",
  };

  return ([1, 2, 3, 4] as const).map((tier) => {
    const acc = tiers[tier];
    const bonePct: Record<string, number> = {};
    const bones: HitBoneCounts = {};
    if (acc.players > 0) {
      for (const [bone, sumPct] of Object.entries(acc.pctSum)) {
        const avg = Math.round((sumPct / acc.players) * 10) / 10;
        if (avg <= 0) continue;
        bonePct[bone] = avg;
        // точки: 1 единица ≈ 1% среднего (мин. 1 если >0)
        bones[bone] = Math.max(1, Math.round(avg));
      }
    }
    return {
      tier,
      label: labels[tier],
      players: acc.players,
      totalHits: acc.totalHits,
      bonePct,
      bones,
    };
  });
}

export { normalizeEosId, normalizeSteamId };
