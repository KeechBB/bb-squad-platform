/** Client-safe tier board types + labels (no Node fs). */

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
  lever?: string | null;
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

export function emptyHomeTierBoard(): HomeTierBoardData {
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
