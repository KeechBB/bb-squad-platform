import { prisma } from "@/lib/prisma";
import { isPublicServerKey } from "@/lib/squadServers";

export type PublicMatchRow = {
  id: string;
  endedAt: string;
  mapName: string;
  layerName: string | null;
  serverKey: string;
  serverLabel: string;
  faction1: string;
  faction1Side: string | null;
  score1: number;
  faction2: string;
  faction2Side: string | null;
  score2: number;
  winnerTeam: number;
  winnerName: string;
};

export type PublicMatchIngestEvent = {
  type?: string;
  at: string;
  serverKey?: string;
  mapName: string;
  layerName?: string | null;
  faction1: string;
  faction1Side?: string | null;
  score1: number;
  faction2: string;
  faction2Side?: string | null;
  score2: number;
  winnerTeam: number;
  winnerName: string;
};

export function publicServerLabel(serverKey: string): string {
  const k = (serverKey || "").trim().toUpperCase();
  if (k === "TPUB1" || k === "PB1" || k === "PUB") return "PB1";
  return serverKey || "—";
}

export function publicMatchEventKey(input: {
  serverKey: string;
  endedAt: Date;
  layerName: string | null | undefined;
  score1: number;
  score2: number;
}): string {
  const layer = (input.layerName || input.serverKey || "layer").trim();
  return [
    input.serverKey,
    String(input.endedAt.getTime()),
    layer,
    String(input.score1),
    String(input.score2),
  ].join("|");
}

export function isSeedLayer(layerName: string | null | undefined): boolean {
  return /\bseed\b/i.test(layerName || "");
}

export async function listPublicMatches(limit = 500): Promise<PublicMatchRow[]> {
  const rows = await prisma.publicMatch.findMany({
    where: {
      OR: [
        { serverKey: "TPUB1" },
        { serverKey: "PB1" },
        { serverKey: "PUB" },
      ],
    },
    orderBy: { endedAt: "desc" },
    take: Math.min(Math.max(limit, 1), 2000),
  });
  return rows.map((r) => ({
    id: r.id,
    endedAt: r.endedAt.toISOString(),
    mapName: r.mapName,
    layerName: r.layerName,
    serverKey: r.serverKey,
    serverLabel: publicServerLabel(r.serverKey),
    faction1: r.faction1,
    faction1Side: r.faction1Side,
    score1: r.score1,
    faction2: r.faction2,
    faction2Side: r.faction2Side,
    score2: r.score2,
    winnerTeam: r.winnerTeam,
    winnerName: r.winnerName,
  }));
}

export function normalizePublicMatchServerKey(
  key: string | null | undefined
): string | null {
  const k = (key || "").trim().toUpperCase();
  if (!k) return null;
  if (isPublicServerKey(k)) return k === "PB1" || k === "PUB" ? "TPUB1" : k;
  return null;
}
