import {
  fruitMatchBrief,
  sideFullLabel,
  type FruitSideSlot,
  type FruitTeam,
} from "@/lib/fruitStrikeBracket";

export type FruitLiveTeam = { name: string; tag: string };

export type FruitLiveRound = {
  ticketsA: number;
  ticketsB: number;
  start?: string;
  end?: string;
  server?: string;
  layer?: string;
  naturalEnd?: boolean;
};

export type FruitLiveMatch = {
  status: "pending" | "done" | string;
  teamA?: FruitLiveTeam;
  teamB?: FruitLiveTeam;
  map?: string;
  r1?: FruitLiveRound;
  r2?: FruitLiveRound;
  sumA?: number;
  sumB?: number;
  scoreLabel?: string;
  winner?: FruitLiveTeam;
  loser?: FruitLiveTeam;
};

export type FruitLiveState = {
  tournamentId: string;
  updatedAt: string | null;
  matches: Record<string, FruitLiveMatch>;
  history: Array<{
    id: string;
    dateLabel: string;
    teamA: string;
    teamB: string;
    map: string;
    score: string;
    result: string;
    winner?: string;
    loser?: string;
  }>;
  playerStats: Array<Record<string, unknown>>;
  teamStats: Array<{
    tag: string;
    name: string;
    matches: number;
    wins?: number;
    winPct: number;
    avgKd: number;
    tournamentsPlayed: number;
    titles: number;
  }>;
};

function teamSlot(t: FruitLiveTeam | undefined): FruitSideSlot | null {
  if (!t?.name) return null;
  return { kind: "team", team: t as FruitTeam };
}

/** Merge static brief with live teams/scores for UI. */
export function fruitMatchView(
  id: string,
  live: FruitLiveState | null
): {
  brief: ReturnType<typeof fruitMatchBrief>;
  liveMatch: FruitLiveMatch | null;
  leftLabel: string;
  rightLabel: string;
  scoreLabel: string | null;
  status: string;
} {
  const brief = fruitMatchBrief(id);
  const liveMatch = live?.matches?.[id] || null;
  const left = teamSlot(liveMatch?.teamA) || brief.left;
  const right = teamSlot(liveMatch?.teamB) || brief.right;
  let scoreLabel: string | null = null;
  if (liveMatch?.status === "done") {
    scoreLabel =
      liveMatch.scoreLabel ||
      `${liveMatch.sumA ?? "—"}:${liveMatch.sumB ?? "—"}`;
  } else if (liveMatch?.r1 && liveMatch.r1.ticketsA != null && liveMatch.r1.ticketsB != null) {
    const r1 = `${liveMatch.r1.ticketsA}:${liveMatch.r1.ticketsB}`;
    scoreLabel = liveMatch.r2
      ? `${r1} / ${liveMatch.r2.ticketsA}:${liveMatch.r2.ticketsB}`
      : `R1 ${r1}`;
  }

  return {
    brief: { ...brief, left, right },
    liveMatch,
    leftLabel: sideFullLabel(left),
    rightLabel: sideFullLabel(right),
    scoreLabel,
    status: liveMatch?.status || "pending",
  };
}
