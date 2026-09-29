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
export async function bonesForUser(
  userId: string
): Promise<{ bones: HitBoneCounts; total: number; lastBone: string | null }> {
  const [rows, last] = await Promise.all([
    prisma.squadHitEvent.groupBy({
      by: ["bone"],
      where: { userId },
      _count: { _all: true },
    }),
    prisma.squadHitEvent.findFirst({
      where: { userId },
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
