import { unstable_cache } from "next/cache";

export type HomeTierTransfer = {
  nick: string;
  fromTier: number;
  toTier: number;
  dir: "up" | "down";
  at: string;
  fit?: number | null;
  note?: string | null;
};

export type HomeTierCandidate = {
  nick: string;
  fromTier: number;
  toTier: number;
  dir: "up" | "down";
  band: string;
  fit: number;
  role?: string | null;
  since?: string;
  daysHeld?: number;
  ready?: boolean;
  note?: string | null;
};

export type HomeTierBoardData = {
  updatedAt: string;
  holdDays: number;
  displayDays: number;
  transfers: HomeTierTransfer[];
  candidates: HomeTierCandidate[];
  source?: string;
};

function emptyBoard(): HomeTierBoardData {
  return {
    updatedAt: "",
    holdDays: 2,
    displayDays: 2,
    transfers: [],
    candidates: [],
    source: "empty",
  };
}

export function tierShort(t: number): string {
  if (t === 1) return "T1";
  if (t === 2) return "T2";
  if (t === 3) return "T3";
  return "T4";
}

export function formatTierArrow(fromTier: number, toTier: number): string {
  return `${tierShort(fromTier)} → ${tierShort(toTier)}`;
}

async function buildHomeTierBoard(): Promise<HomeTierBoardData> {
  const { loadKvJsonCached } = await import("@/lib/kvLocal");
  const raw = await loadKvJsonCached<Record<string, unknown>>(
    "data/tier-board.json"
  );
  if (!raw) {
    console.warn("[homeTierBoard] tier-board.json missing on VPS disk");
    return emptyBoard();
  }
  const transfers = Array.isArray(raw?.transfers) ? raw.transfers : [];
  const candidates = Array.isArray(raw?.candidates) ? raw.candidates : [];
  return {
    updatedAt: String(raw?.updatedAt || ""),
    holdDays: Number(raw?.holdDays) || 2,
    displayDays: Number(raw?.displayDays) || 2,
    source: String(raw?.source || "vps-disk:tier-board.json"),
    transfers: transfers.map((t: Record<string, unknown>) => ({
      nick: String(t.nick || ""),
      fromTier: Number(t.fromTier) || 4,
      toTier: Number(t.toTier) || 4,
      dir: t.dir === "down" || Number(t.toTier) > Number(t.fromTier) ? "down" : "up",
      at: String(t.at || ""),
      fit: t.fit == null ? null : Number(t.fit),
      note: t.note == null ? null : String(t.note),
    })),
    candidates: candidates.map((c: Record<string, unknown>) => ({
      nick: String(c.nick || ""),
      fromTier: Number(c.fromTier) || 4,
      toTier: Number(c.toTier) || 4,
      dir: c.dir === "down" ? "down" : "up",
      band: String(c.band || "almost"),
      fit: Number(c.fit) || 0,
      role: c.role == null ? null : String(c.role),
      since: c.since == null ? undefined : String(c.since),
      daysHeld: c.daysHeld == null ? undefined : Number(c.daysHeld),
      ready: Boolean(c.ready),
      note: c.note == null ? null : String(c.note),
    })),
  };
}

export const getHomeTierBoard = unstable_cache(
  buildHomeTierBoard,
  ["home-tier-board-v2-disk"],
  { revalidate: 45 }
);

export { emptyBoard as emptyHomeTierBoard, buildHomeTierBoard };
