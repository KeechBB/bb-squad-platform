import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { Prisma, type CanonMatchKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isBuiltinSuperAdmin } from "@/lib/admin";
import { FACTION_LOGO_DIR } from "@/lib/factionLogoFile";
import { factionCanonColor } from "@/lib/factionColors";
import { mainKits } from "@/lib/factions";
import { nickCompact } from "@/lib/nickIdentity";
import { mskDayBoundsUtc } from "@/lib/squadHits";
import { canonKitName } from "@/lib/squadKits";
import { mskParts } from "@/lib/squadSessions";

const LIVE_ROLE: Record<string, "rifleman" | "medic" | "lat"> = {
  Стрелок: "rifleman",
  Медик: "medic",
  "Легкая Труба": "lat",
};

const LADDER_FILE: Record<"rifleman" | "medic" | "lat", string> = {
  rifleman: "rifle-ladder.json",
  medic: "medic-ladder.json",
  lat: "lat-ladder.json",
};

function ymdFromParts(y: number, m: number, day: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function ymdMsk(d = new Date()): string {
  const p = mskParts(d);
  return ymdFromParts(p.y, p.m, p.day);
}

function addDays(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return ymdFromParts(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

function dateLabel(ymd: string): string {
  return `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}`;
}

/**
 * Скользящие 7 календарных дней по МСК, включая сегодня.
 * Залитая сегодняшняя катка сразу попадает в Тренировки / КВ / аналитику / рейтинги.
 */
export function rollingLast7Days(now = new Date()): { days: string[]; label: string } {
  const end = ymdMsk(now);
  const days = Array.from({ length: 7 }, (_, i) => addDays(end, i - 6));
  return { days, label: `${dateLabel(days[0])}–${dateLabel(days[6])}` };
}

/** @deprecated имя оставлено для старых импортов — это уже не календарная неделя пн–вс */
export function currentWeek(now = new Date()): { days: string[]; label: string } {
  return rollingLast7Days(now);
}

function rgbToHsl(r: number, g: number, b: number) {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === R) h = (G - B) / d + (G < B ? 6 : 0);
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  return { h: h / 6, s, l };
}

function hslToHex(h: number, s: number, l: number): string {
  const hue = (p: number, q: number, t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hex = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n * 255)))
      .toString(16)
      .padStart(2, "0");
  return `#${hex(hue(p, q, h + 1 / 3))}${hex(hue(p, q, h))}${hex(hue(p, q, h - 1 / 3))}`;
}

/** Базовый оттенок логотипа (0..1) или null. */
async function factionLogoHue(factionId: string): Promise<number | null> {
  const file = path.join(FACTION_LOGO_DIR, `${factionId}.png`);
  try {
    const { data } = await sharp(file)
      .resize(32, 32, { fit: "fill" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const buckets = new Map<number, { score: number; r: number; g: number; b: number }>();
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      if (a < 90) continue;
      if (r > 235 && g > 235 && b > 235) continue;
      const hsl = rgbToHsl(r, g, b);
      if (hsl.s < 0.22 || hsl.l < 0.1 || hsl.l > 0.92) continue;
      const bin = Math.min(23, Math.floor(hsl.h * 24));
      const bucket = buckets.get(bin) || { score: 0, r: 0, g: 0, b: 0 };
      const w = hsl.s * (0.35 + hsl.l);
      bucket.score += w;
      bucket.r += r * w;
      bucket.g += g * w;
      bucket.b += b * w;
      buckets.set(bin, bucket);
    }
    let best: { score: number; r: number; g: number; b: number } | null = null;
    for (const bucket of buckets.values()) {
      if (!best || bucket.score > best.score) best = bucket;
    }
    if (!best || best.score <= 0) return null;
    return rgbToHsl(best.r / best.score, best.g / best.score, best.b / best.score).h;
  } catch {
    return null;
  }
}

/** Цвет фракции для UI: канон по имени/slug, иначе оттенок логотипа. */
export async function factionLogoColor(
  factionId: string,
  name?: string | null,
  slug?: string | null
): Promise<string> {
  const canon = factionCanonColor(name, slug);
  if (canon) return canon;
  const hue = await factionLogoHue(factionId);
  if (hue == null) return "#f4f0e8";
  return hslToHex(hue, 0.82, 0.64);
}

/** Цвета секторов рейтингов — только канон (или логотип для неизвестных фракций). */
export async function factionRingColors(
  factions: { id: string; name: string; slug: string }[]
): Promise<string[]> {
  return Promise.all(factions.map((f) => factionLogoColor(f.id, f.name, f.slug)));
}

function roundTo(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((s, n) => s + n, 0) / values.length;
}

type MemberRef = { factionId: string; key: string };

function indexMembers(
  factions: { id: string; members: { user: { nick: string | null; steamName: string | null; steamId: string | null } }[] }[]
): Map<string, MemberRef> {
  const buckets = new Map<string, MemberRef[]>();
  for (const f of factions) {
    for (const m of f.members) {
      if (isBuiltinSuperAdmin(m.user.steamId)) continue;
      const nick = m.user.nick || m.user.steamName || "";
      const key = nickCompact(nick);
      if (!key) continue;
      const list = buckets.get(key) || [];
      list.push({ factionId: f.id, key });
      buckets.set(key, list);
    }
  }
  const out = new Map<string, MemberRef>();
  for (const [key, list] of buckets) {
    if (list.length === 1) out.set(key, list[0]);
  }
  return out;
}

export type FactionWeekRow = {
  factionId: string;
  name: string;
  color: string;
  week: string;
  people: number;
  perMatch: number | null;
  kd: number | null;
};

export async function factionWeekBoard(
  clanId: string,
  kind: "cw" | "train"
): Promise<{ week: string; rows: FactionWeekRow[] }> {
  const week = rollingLast7Days();
  const factions = await prisma.faction.findMany({
    where: { clanId },
    orderBy: { name: "asc" },
    include: {
      members: {
        include: {
          user: { select: { nick: true, steamName: true, steamId: true } },
        },
      },
    },
  });
  const byNick = indexMembers(factions);
  const canonKind: CanonMatchKind = kind === "cw" ? "CW" : "TRAIN";
  const matches = await prisma.canonMatch.findMany({
    where: {
      kind: canonKind,
      OR: week.days.map((ymd) => {
        const [year, month, day] = ymd.split("-").map(Number);
        return { year, month, day };
      }),
    },
    select: {
      year: true,
      month: true,
      day: true,
      players: { select: { nick: true, kills: true, deaths: true } },
    },
  });

  const people = new Map<string, Set<string>>();
  const kills = new Map<string, Map<string, { k: number; d: number }>>();
  const matchHeads = new Map<string, number[]>();
  const dayHeads = new Map<string, Map<string, number[]>>();

  for (const match of matches) {
    const ymd = ymdFromParts(match.year, match.month, match.day);
    const seen = new Map<string, Map<string, { k: number; d: number }>>();
    for (const pl of match.players) {
      const ref = byNick.get(nickCompact(pl.nick));
      if (!ref) continue;
      let bucket = seen.get(ref.factionId);
      if (!bucket) {
        bucket = new Map();
        seen.set(ref.factionId, bucket);
      }
      const cur = bucket.get(ref.key) || { k: 0, d: 0 };
      cur.k += pl.kills || 0;
      cur.d += pl.deaths || 0;
      bucket.set(ref.key, cur);
    }
    for (const [fid, bucket] of seen) {
      const heads = matchHeads.get(fid) || [];
      heads.push(bucket.size);
      matchHeads.set(fid, heads);
      let days = dayHeads.get(fid);
      if (!days) {
        days = new Map();
        dayHeads.set(fid, days);
      }
      const list = days.get(ymd) || [];
      list.push(bucket.size);
      days.set(ymd, list);
      const who = people.get(fid) || new Set<string>();
      const kd = kills.get(fid) || new Map<string, { k: number; d: number }>();
      for (const [key, stat] of bucket) {
        who.add(key);
        const tot = kd.get(key) || { k: 0, d: 0 };
        tot.k += stat.k;
        tot.d += stat.d;
        kd.set(key, tot);
      }
      people.set(fid, who);
      kills.set(fid, kd);
    }
  }

  const colors = await Promise.all(factions.map((f) => factionLogoColor(f.id, f.name, f.slug)));
  const rows: FactionWeekRow[] = factions.map((f, i) => {
    const kdMap = kills.get(f.id);
    const personal: number[] = [];
    if (kdMap) {
      for (const stat of kdMap.values()) {
        personal.push(stat.d > 0 ? stat.k / stat.d : stat.k);
      }
    }
    const kdMean = mean(personal);
    let perMatch: number | null = null;
    if (kind === "cw") {
      const avg = mean(matchHeads.get(f.id) || []);
      perMatch = avg == null ? null : roundTo(avg, 1);
    } else {
      const days = dayHeads.get(f.id);
      const daily = days ? [...days.values()].map((list) => mean(list)).filter((n): n is number => n != null) : [];
      const avg = mean(daily);
      perMatch = avg == null ? null : roundTo(avg, 1);
    }
    return {
      factionId: f.id,
      name: f.name,
      color: colors[i],
      week: week.label,
      people: people.get(f.id)?.size || 0,
      perMatch,
      kd: kdMean == null ? null : roundTo(kdMean, 2),
    };
  });

  return { week: week.label, rows };
}

type LadderPlayer = { nick?: string; level?: number | null };

function readLadder(role: "rifleman" | "medic" | "lat"): Map<string, number> {
  const file = path.join(process.cwd(), "data", "kv-cache", "data", LADDER_FILE[role]);
  const out = new Map<string, number>();
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8")) as { players?: LadderPlayer[] };
    for (const p of data.players || []) {
      const key = nickCompact(p.nick || "");
      if (!key || p.level == null || !Number.isFinite(Number(p.level))) continue;
      out.set(key, roundTo(Number(p.level), 2));
    }
  } catch {
    /* лестница ещё не лежит */
  }
  return out;
}

type Snap = Record<string, Record<string, number>>;

function snapPath(): string {
  return path.join(process.cwd(), "data", "faction-level-daily.json");
}

function readSnap(): Record<string, Snap> {
  try {
    const raw = JSON.parse(fs.readFileSync(snapPath(), "utf8")) as Record<string, Snap>;
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function writeSnap(data: Record<string, Snap>) {
  const file = snapPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data), "utf8");
  fs.renameSync(tmp, file);
}

export type FactionGrowthRow = {
  order: number;
  userId: string;
  nick: string;
  name: string;
  role: string;
  live: boolean;
  level: number | null;
  delta: number | null;
  yesterday: number | null;
};

export async function factionGrowthBoard(factionId: string): Promise<FactionGrowthRow[]> {
  const members = await prisma.factionMember.findMany({
    where: { factionId },
    orderBy: { joinedAt: "asc" },
    include: {
      user: { select: { id: true, nick: true, name: true, steamName: true, steamId: true } },
    },
  });
  const listed = members.filter((m) => !isBuiltinSuperAdmin(m.user.steamId));
  const kits = await mainKits(listed.map((m) => m.userId));
  const ladders = {
    rifleman: readLadder("rifleman"),
    medic: readLadder("medic"),
    lat: readLadder("lat"),
  };
  const today = ymdMsk();
  const yesterday = addDays(today, -1);
  const snap = readSnap();
  const prev = snap[yesterday] || {};
  const todaySnap: Snap = { rifleman: {}, medic: {}, lat: {} };

  const rows: FactionGrowthRow[] = listed.map((m, i) => {
    const role = kits.get(m.userId) || "—";
    const slug = LIVE_ROLE[role];
    const key = nickCompact(m.user.nick || m.user.steamName || "");
    const level = slug && key ? ladders[slug].get(key) ?? null : null;
    if (slug && key && level != null) todaySnap[slug][key] = level;
    const y = slug && key ? prev[slug]?.[key] : undefined;
    const delta = level != null && y != null ? roundTo(level - y, 2) : null;
    return {
      order: i + 1,
      userId: m.userId,
      nick: m.user.nick || m.user.steamName || "—",
      name: m.user.name || "",
      role,
      live: Boolean(slug),
      level,
      delta,
      yesterday: y ?? null,
    };
  });

  const next: Record<string, Snap> = {};
  for (const [day, body] of Object.entries(snap)) {
    if (day >= addDays(today, -21)) next[day] = body;
  }
  next[today] = todaySnap;
  try {
    writeSnap(next);
  } catch {
    /* снимок не обязателен для ответа */
  }
  return rows;
}

export async function clanFactionPicks(clanId: string) {
  const factions = await prisma.faction.findMany({
    where: { clanId },
    orderBy: { name: "asc" },
    select: { id: true, slug: true, name: true },
  });
  const colors = await Promise.all(factions.map((f) => factionLogoColor(f.id, f.name, f.slug)));
  return factions.map((f, i) => ({ slug: f.slug, name: f.name, color: colors[i] }));
}

export type FactionRoleSlice = {
  kit: string;
  players: number;
  pct: number;
};

/** Основная роль каждого игрока фракции — кит с наибольшим временем за последние 7 полных дней (МСК, сдвиг в 01:00). */
export async function factionRoleDonut(factionId: string): Promise<{
  week: string;
  total: number;
  slices: FactionRoleSlice[];
}> {
  const week = rollingLast7Days();
  const from = mskDayBoundsUtc(week.days[0]);
  const to = mskDayBoundsUtc(week.days[6]);
  const empty = { week: week.label, total: 0, slices: [] as FactionRoleSlice[] };
  if (!from || !to) return empty;

  const members = await prisma.factionMember.findMany({
    where: { factionId },
    include: { user: { select: { id: true, steamId: true } } },
  });
  const listed = members.filter((m) => !isBuiltinSuperAdmin(m.user.steamId));
  const userIds = listed.map((m) => m.userId);
  const steamIds = listed.map((m) => m.user.steamId).filter((s): s is string => Boolean(s));
  if (!userIds.length) return empty;

  const whoSql = steamIds.length
    ? Prisma.sql`("userId" IN (${Prisma.join(userIds)}) OR "steamId" IN (${Prisma.join(steamIds)}))`
    : Prisma.sql`"userId" IN (${Prisma.join(userIds)})`;

  const rows = await prisma.$queryRaw<{ uid: string | null; sid: string; kit: string; sec: bigint }[]>`
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
      WHERE "serverKey" IN ('TR1', 'TR2')
        AND "spawnedAt" >= ${from.gte}
        AND "spawnedAt" < ${to.lt}
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

  const memberIds = new Set(userIds);
  const idBySteam = new Map(listed.filter((m) => m.user.steamId).map((m) => [m.user.steamId as string, m.userId]));
  const byUser = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const userId = row.uid && memberIds.has(row.uid) ? row.uid : idBySteam.get(row.sid) || "";
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

  const counts = new Map<string, number>();
  for (const kits of byUser.values()) {
    let bestKit = "";
    let bestSec = -1;
    for (const [kit, sec] of kits) {
      if (sec > bestSec || (sec === bestSec && kit.localeCompare(bestKit, "ru") < 0)) {
        bestKit = kit;
        bestSec = sec;
      }
    }
    if (!bestKit) continue;
    counts.set(bestKit, (counts.get(bestKit) || 0) + 1);
  }

  const total = [...counts.values()].reduce((s, n) => s + n, 0);
  const slices = [...counts.entries()]
    .map(([kit, players]) => ({
      kit,
      players,
      pct: total ? Math.round((players * 1000) / total) / 10 : 0,
    }))
    .sort((a, b) => b.players - a.players || a.kit.localeCompare(b.kit, "ru"));
  const drift = Math.round((100 - slices.reduce((s, r) => s + r.pct, 0)) * 10) / 10;
  if (slices.length && Math.abs(drift) >= 0.1 && total) {
    slices[0] = { ...slices[0], pct: Math.round((slices[0].pct + drift) * 10) / 10 };
  }
  return { week: week.label, total, slices };
}

export type FactionRatingSlice = {
  factionId: string;
  name: string;
  color: string;
  value: number;
  pct: number;
};

export type FactionRatingChart = {
  id: "people" | "kills" | "deaths" | "res";
  title: string;
  total: number;
  slices: FactionRatingSlice[];
};

function pctSlices(
  rows: { factionId: string; name: string; color: string; value: number }[]
): FactionRatingSlice[] {
  const total = rows.reduce((s, r) => s + r.value, 0);
  const live = rows.filter((r) => r.value > 0);
  const slices = live
    .map((r) => ({
      ...r,
      pct: total ? Math.round((r.value * 1000) / total) / 10 : 0,
    }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, "ru"));
  const drift = Math.round((100 - slices.reduce((s, r) => s + r.pct, 0)) * 10) / 10;
  if (slices.length && Math.abs(drift) >= 0.1 && total) {
    slices[0] = { ...slices[0], pct: Math.round((slices[0].pct + drift) * 10) / 10 };
  }
  return slices;
}

/**
 * Доли фракций на тренировках за последние 7 полных дней (МСК, сдвиг в 01:00):
 * люди / убийства / смерти / ресы.
 */
export async function factionRatingsBoard(clanId: string): Promise<{
  week: string;
  charts: FactionRatingChart[];
}> {
  const week = rollingLast7Days();
  const factions = await prisma.faction.findMany({
    where: { clanId },
    orderBy: { name: "asc" },
    include: {
      members: {
        include: {
          user: { select: { nick: true, steamName: true, steamId: true } },
        },
      },
    },
  });
  const byNick = indexMembers(factions);
  const matches = await prisma.canonMatch.findMany({
    where: {
      kind: "TRAIN",
      OR: week.days.map((ymd) => {
        const [year, month, day] = ymd.split("-").map(Number);
        return { year, month, day };
      }),
    },
    select: {
      players: { select: { nick: true, kills: true, deaths: true, res: true } },
    },
  });

  const people = new Map<string, Set<string>>();
  const kills = new Map<string, number>();
  const deaths = new Map<string, number>();
  const res = new Map<string, number>();

  for (const match of matches) {
    for (const pl of match.players) {
      const ref = byNick.get(nickCompact(pl.nick));
      if (!ref) continue;
      const who = people.get(ref.factionId) || new Set<string>();
      who.add(ref.key);
      people.set(ref.factionId, who);
      kills.set(ref.factionId, (kills.get(ref.factionId) || 0) + (pl.kills || 0));
      deaths.set(ref.factionId, (deaths.get(ref.factionId) || 0) + (pl.deaths || 0));
      res.set(ref.factionId, (res.get(ref.factionId) || 0) + (pl.res || 0));
    }
  }

  const colors = await factionRingColors(
    factions.map((f) => ({ id: f.id, name: f.name, slug: f.slug }))
  );
  const base = factions.map((f, i) => ({
    factionId: f.id,
    name: f.name,
    color: colors[i],
  }));

  const charts: FactionRatingChart[] = [
    {
      id: "people",
      title: "Средний онлайн на тренировках",
      total: base.reduce((s, f) => s + (people.get(f.factionId)?.size || 0), 0),
      slices: pctSlices(
        base.map((f) => ({ ...f, value: people.get(f.factionId)?.size || 0 }))
      ),
    },
    {
      id: "kills",
      title: "Убийства",
      total: base.reduce((s, f) => s + (kills.get(f.factionId) || 0), 0),
      slices: pctSlices(base.map((f) => ({ ...f, value: kills.get(f.factionId) || 0 }))),
    },
    {
      id: "deaths",
      title: "Смерти",
      total: base.reduce((s, f) => s + (deaths.get(f.factionId) || 0), 0),
      slices: pctSlices(base.map((f) => ({ ...f, value: deaths.get(f.factionId) || 0 }))),
    },
    {
      id: "res",
      title: "Ресы",
      total: base.reduce((s, f) => s + (res.get(f.factionId) || 0), 0),
      slices: pctSlices(base.map((f) => ({ ...f, value: res.get(f.factionId) || 0 }))),
    },
  ];

  return { week: week.label, charts };
}
