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
): Promise<{ bones: HitBoneCounts; total: number }> {
  const rows = await prisma.squadHitEvent.groupBy({
    by: ["bone"],
    where: { userId },
    _count: { _all: true },
  });
  const bones: HitBoneCounts = {};
  let total = 0;
  for (const r of rows) {
    const n = r._count._all;
    bones[r.bone] = n;
    total += n;
  }
  return { bones, total };
}

export { normalizeEosId, normalizeSteamId };
