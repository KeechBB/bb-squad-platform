/** Client-safe types + colors for evening tier chart (no Node/fs). */

export const TIER_KEYS = ["T1", "T2", "T3", "T4"] as const;
export type TierKey = (typeof TIER_KEYS)[number];

export const TIER_COLORS: Record<TierKey, string> = {
  T1: "#7dd3fc",
  T2: "#86efac",
  T3: "#fde047",
  T4: "#a78bfa",
};

export type EveningTierDay = {
  day: string;
  label: string;
  dow: string;
  counts: Record<TierKey, number>;
  total: number;
  isToday: boolean;
};

export type EveningTierBoard = {
  mode: "week" | "month";
  from: string;
  to: string;
  window: "21:00–00:00 МСК";
  servers: "TR1 + TR2";
  todayEve: string;
  days: EveningTierDay[];
  today: EveningTierDay;
  avg: Record<TierKey, number>;
  monthUnique: Record<TierKey, number>;
  sumEvenings: Record<TierKey, number>;
  updatedAt: string;
};
