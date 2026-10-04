import { unstable_cache } from "next/cache";
import {
  emptyHomeTierBoard,
  type HomeTierBoardData,
  type HomeTierCandidate,
  type HomeTierTransfer,
} from "@/lib/homeTierBoardUi";

export type {
  HomeTierTransfer,
  HomeTierCandidate,
  HomeTierBoardData,
} from "@/lib/homeTierBoardUi";
export {
  emptyHomeTierBoard,
  tierShort,
  formatTierArrow,
} from "@/lib/homeTierBoardUi";

async function buildHomeTierBoard(): Promise<HomeTierBoardData> {
  const { loadKvJsonCached } = await import("@/lib/kvLocal");
  const raw = await loadKvJsonCached<Record<string, unknown>>(
    "data/tier-board.json"
  );
  if (!raw) {
    console.warn("[homeTierBoard] tier-board.json missing on VPS disk");
    return emptyHomeTierBoard();
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
    })) as HomeTierTransfer[],
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
    })) as HomeTierCandidate[],
  };
}

export const getHomeTierBoard = unstable_cache(
  buildHomeTierBoard,
  ["home-tier-board-v2-disk"],
  { revalidate: 45 }
);

export { buildHomeTierBoard };
