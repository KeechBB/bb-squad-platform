/**
 * Phase 8: mirror PublicMatch → CanonMatch (kind PUBLIC, source LOG).
 */
import { prisma } from "@/lib/prisma";

function mskParts(d: Date): { y: number; m: number; day: number; h: number; min: number } {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(d).map((p) => [p.type, p.value])
  ) as Record<string, string>;
  return {
    y: Number(parts.year),
    m: Number(parts.month),
    day: Number(parts.day),
    h: Number(parts.hour),
    min: Number(parts.minute),
  };
}

function slugMap(name: string): string {
  return (name || "").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 32) || "map";
}

function serverKeyNorm(sk: string): string {
  const u = (sk || "").toUpperCase();
  if (u.includes("PB1") || u.includes("TPUB") || u === "PUB") return "pb1";
  const m = u.match(/TR\d+/);
  if (m) return m[0].toLowerCase();
  return "pb1";
}

export type PublicMatchCanonInput = {
  eventKey: string;
  serverKey: string;
  endedAt: Date;
  mapName: string;
  layerName?: string | null;
  faction1: string;
  score1: number;
  faction2: string;
  score2: number;
  winnerTeam: number;
  winnerName: string;
};

/** Upsert one PUBLIC row into CanonMatch. Soft-fail → null. */
export async function upsertCanonFromPublicMatch(
  pm: PublicMatchCanonInput
): Promise<string | null> {
  try {
    const p = mskParts(pm.endedAt);
    const layer = pm.layerName || pm.mapName;
    const sk = serverKeyNorm(pm.serverKey);
    const hm = `${String(p.h).padStart(2, "0")}${String(p.min).padStart(2, "0")}`;
    const matchKey = `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.day).padStart(2, "0")}_${sk}_${slugMap(layer)}_${hm}`;
    const legacyId = pm.eventKey.slice(0, 120);
    const winner =
      pm.winnerTeam === 1 ? pm.faction1 : pm.winnerTeam === 2 ? pm.faction2 : pm.winnerName;

    const existing = await prisma.canonMatch.findFirst({
      where: {
        OR: [
          { matchKey },
          {
            kind: "PUBLIC",
            year: p.y,
            month: p.m,
            legacyId,
          },
        ],
      },
    });

    const data = {
      matchKey,
      kind: "PUBLIC" as const,
      source: "LOG" as const,
      legacyId,
      year: p.y,
      month: p.m,
      day: p.day,
      timeMsk: `${String(p.h).padStart(2, "0")}:${String(p.min).padStart(2, "0")}`,
      endedAt: pm.endedAt,
      serverKey: sk,
      serverLabel: pm.serverKey,
      mapName: layer,
      factionA: pm.faction1,
      ticketsA: pm.score1,
      factionB: pm.faction2,
      ticketsB: pm.score2,
      winner,
      status: "done",
      publishedAt: new Date(),
      rawJson: {
        eventKey: pm.eventKey,
        mapName: pm.mapName,
        layerName: pm.layerName,
        winnerTeam: pm.winnerTeam,
        winnerName: pm.winnerName,
      },
    };

    if (existing) {
      await prisma.canonMatch.update({
        where: { id: existing.id },
        data,
      });
      return existing.id;
    }
    const created = await prisma.canonMatch.create({ data });
    return created.id;
  } catch (e) {
    console.warn("[canonPublicUpsert]", e);
    return null;
  }
}
