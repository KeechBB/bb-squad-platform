/** Client-safe Hunt types/helpers (no Node fs). */

export const KEECH_STEAM = "76561198028435874";

export type KeechHuntEvent = {
  id: string;
  kind: "nok" | "kill" | "death" | "revive" | "self";
  at: string;
  time: string;
  nick: string;
  delta: number;
  oppWeight: number;
  bones?: Record<string, number>;
  server?: string;
  layerShort?: string;
  matchId?: string;
};

export type KeechHuntMatch = {
  id: string;
  server: string;
  layer: string;
  layerShort: string;
  startAt: string;
  endAt: string | null;
  events: KeechHuntEvent[];
  net: number;
  noks?: number;
  kills: number;
  deaths: number;
  revives: number;
};

export type KeechHuntLive = {
  updatedAt: string;
  match: KeechHuntMatch | null;
  matches?: KeechHuntMatch[];
  keechSteam: string;
};

/** Keep only events that belong to this match/map (drop glued leftovers). */
export function eventsForMatch(match: KeechHuntMatch | null | undefined): KeechHuntEvent[] {
  if (!match) return [];
  const layer = String(match.layerShort || "").trim();
  const startAt = String(match.startAt || "");
  const matchId = String(match.id || "");
  return (match.events || []).filter((e) => {
    if (matchId && e.matchId && e.matchId !== matchId) return false;
    if (
      layer &&
      layer !== "?" &&
      e.layerShort &&
      e.layerShort !== "?" &&
      e.layerShort !== layer
    ) {
      return false;
    }
    if (startAt && e.at && String(e.at) < startAt) return false;
    return true;
  });
}

export function serverLabel(server: string | null | undefined): string {
  const s = String(server || "").toUpperCase();
  if (s === "TPUB1" || s === "PB1" || s === "PUB") return "PB1";
  return s || "?";
}

export function splitEvents(events: KeechHuntEvent[]) {
  const noks = events.filter((e) => e.kind === "nok");
  const kills = events.filter((e) => e.kind === "kill");
  const deaths = events.filter((e) => e.kind === "death" || e.kind === "self");
  const revives = events.filter((e) => e.kind === "revive");
  return { noks, kills, deaths, revives };
}

export function openKeechHuntMatches(live: KeechHuntLive): KeechHuntMatch[] {
  const fromList = Array.isArray(live.matches) ? live.matches : [];
  if (fromList.length) {
    return fromList.filter((m) => m && !m.endAt);
  }
  return live.match && !live.match.endAt ? [live.match] : [];
}

export function mergeKeechHuntEvents(matches: KeechHuntMatch[]): KeechHuntEvent[] {
  const out: KeechHuntEvent[] = [];
  for (const m of matches) {
    for (const e of m.events || []) {
      out.push({
        ...e,
        server: e.server || m.server,
      });
    }
  }
  return out.sort((a, b) => String(a.at).localeCompare(String(b.at)));
}
