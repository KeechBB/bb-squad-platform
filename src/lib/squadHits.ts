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

export async function bonesForUser(
  userId: string,
  opts: BonesForUserOpts = {}
): Promise<{ bones: HitBoneCounts; total: number; lastBone: string | null }> {
  const day = opts.dayYmd?.trim() || null;
  const bounds = day ? mskDayBoundsUtc(day) : null;
  const where = {
    userId,
    ...(bounds ? { hitAt: { gte: bounds.gte, lt: bounds.lt } } : {}),
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
    const n = r._count._all;
    bones[r.bone] = n;
    total += n;
  }
  const lastBone = last?.bone && last.bone !== "None" ? last.bone : null;
  return { bones, total, lastBone };
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

/** Средние профили попаданий по тирам 1–4 (зарегистрированные с хитами). */
export async function hitmapAveragesByTier(): Promise<TierHitmapAvg[]> {
  const { loadTierIndex } = await import("@/lib/tiers");
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
    if (!g.bone || g.bone === "None") continue;
    const cur = byUser.get(g.userId) || {};
    cur[g.bone] = g._count._all;
    byUser.set(g.userId, cur);
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
