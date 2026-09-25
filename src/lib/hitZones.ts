import { prisma } from "@/lib/prisma";
import { normalizeEosId, normalizeSteamId } from "@/lib/squadSessions";

export type HitZone = "Head" | "Torso" | "Limb";

export type HitZoneIngestEvent = {
  type: "hitzone";
  at: string;
  serverKey?: string;
  zone: HitZone | string;
  attackerEosId?: string | null;
  attackerSteamId?: string | null;
  victimEosId?: string | null;
  damage?: number | null;
  bone?: string | null;
  weapon?: string | null;
  /** Идемпотентность: serverKey|eos|at|zone|bone|damage */
  eventKey?: string | null;
};

const ZONE_SET = new Set(["Head", "Torso", "Limb"]);

export function normalizeZone(raw: string): HitZone | null {
  const z = (raw || "").trim();
  if (ZONE_SET.has(z)) return z as HitZone;
  const lower = z.toLowerCase();
  if (lower === "head") return "Head";
  if (lower === "torso" || lower === "body" || lower === "chest") return "Torso";
  if (lower === "limb" || lower === "limbs" || lower === "arms" || lower === "legs")
    return "Limb";
  return null;
}

/** Calendar day in Europe/Moscow for training aggregates. */
export function ymdMskFromIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Moscow" });
  }
  return d.toLocaleDateString("en-CA", { timeZone: "Europe/Moscow" });
}

export type HitZoneTotals = {
  head: number;
  torso: number;
  limb: number;
  total: number;
  pctHead: number;
  pctTorso: number;
  pctLimb: number;
  days: number;
};

export function totalsFromDays(
  rows: { hitsHead: number; hitsTorso: number; hitsLimb: number }[]
): HitZoneTotals {
  let head = 0;
  let torso = 0;
  let limb = 0;
  for (const r of rows) {
    head += r.hitsHead;
    torso += r.hitsTorso;
    limb += r.hitsLimb;
  }
  const total = head + torso + limb;
  const pct = (n: number) => (total > 0 ? Math.round((1000 * n) / total) / 10 : 0);
  return {
    head,
    torso,
    limb,
    total,
    pctHead: pct(head),
    pctTorso: pct(torso),
    pctLimb: pct(limb),
    days: rows.length,
  };
}

export async function loadUserHitZoneStats(
  userId: string,
  days = 30,
  serverKey = "TR1"
): Promise<HitZoneTotals> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);
  const sinceYmd = since.toLocaleDateString("en-CA", { timeZone: "Europe/Moscow" });
  const rows = await prisma.trainHitZoneDay.findMany({
    where: {
      userId,
      serverKey,
      ymd: { gte: sinceYmd },
    },
    select: { hitsHead: true, hitsTorso: true, hitsLimb: true },
  });
  return totalsFromDays(rows);
}

export async function resolveAttackerSteam(
  rawSteam: string | null | undefined,
  eosId: string | null | undefined
): Promise<{ steamId: string; userId: string } | null> {
  let steamId = normalizeSteamId(rawSteam || "");
  const eos = normalizeEosId(eosId || "") || null;
  if (!steamId && eos) {
    const mapped = await prisma.squadEosSteamMap.findUnique({
      where: { eosId: eos },
      select: { steamId: true },
    });
    steamId = normalizeSteamId(mapped?.steamId || "") || "";
  }
  if (!steamId) return null;
  const user = await prisma.user.findUnique({
    where: { steamId },
    select: { id: true },
  });
  if (!user) return null;
  return { steamId, userId: user.id };
}
