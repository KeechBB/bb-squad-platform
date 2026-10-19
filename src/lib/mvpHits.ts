export type MvpMatchHit = {
  id: string;
  dateLabel: string;
  title: string;
  sub?: string;
  playersUrl?: string | null;
};

export type MvpHits = {
  killer: MvpMatchHit[];
  medic: MvpMatchHit[];
  armor: MvpMatchHit[];
};

export type MvpKind = "killer" | "medic" | "armor";

export function emptyMvpHits(): MvpHits {
  return { killer: [], medic: [], armor: [] };
}

/** Awards КВ (mvp-ledger) → списки матчей по типу MVP. */
export function mvpHitsFromKvAwards(
  awards: {
    matchId: string;
    dateLabel: string;
    opp: string;
    round: string;
    type: string;
  }[]
): MvpHits {
  const out = emptyMvpHits();
  for (const a of awards || []) {
    const type = String(a.type || "").toLowerCase();
    let kind: MvpKind | null = null;
    if (type === "killer") kind = "killer";
    else if (type === "medic") kind = "medic";
    else if (type === "armor" || type === "antideath" || type === "anti")
      kind = "armor";
    if (!kind) continue;
    out[kind].push({
      id: `${a.matchId}-${a.round}-${kind}`,
      dateLabel: a.dateLabel || "—",
      title: a.opp || "—",
      sub: a.round ? `раунд ${a.round}` : undefined,
    });
  }
  return out;
}
