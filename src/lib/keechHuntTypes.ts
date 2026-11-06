/** Client-safe Hunt types/helpers (no Node fs). */

export const KEECH_STEAM = "76561198028435874";

export type KeechHuntEventKind =
  | "nok"
  | "gotnok"
  | "kill"
  | "death"
  | "revive"
  | "self"
  | "vehicle_kill"
  | "vehicle_loss"
  | "vehicle_loss_driver"
  | "driver_share"
  | "hit"
  | "gothit"
  | "suppress"
  | "gotsuppress"
  | "accuracy"
  | "heal"
  | "gotheal";

export type KeechHuntEvent = {
  id: string;
  kind: KeechHuntEventKind;
  at: string;
  time: string;
  nick: string;
  /** Kit from last DeployRole before the event (Rifleman → Стрелок, …). */
  kit?: string;
  delta: number;
  oppWeight: number;
  bones?: Record<string, number>;
  server?: string;
  layerShort?: string;
  matchId?: string;
  teamkill?: boolean;
  /** Human label for vehicle / driver_share / hit zone. */
  label?: string;
  vehicle?: string;
  tickets?: number | null;
  /** Soft-cap multiplier applied to this gain (Immortal…Predator). */
  gainCoef?: number | null;
  reason?: string;
  /** Hit zone / bone label (RU). */
  zone?: string;
  damage?: number;
  suppress?: number;
  /** HP healed (BBHealTracker). */
  heal?: number;
  /** Running combat accuracy snapshot (hits / shots). */
  shots?: number;
  hits?: number;
  accuracyPct?: number | null;
};

export type KeechHuntCombat = {
  shots: number;
  hits: number;
  accuracyPct: number | null;
  /** False when BBAcuracy never reported Keech (e.g. Jensen dumps {}). */
  shotsKnown?: boolean;
  suppressTotal: number;
  suppressNow: { nick: string; value: number }[];
  suppressOnMe?: number;
  /** Σ HP Keech healed on others (BBHealTracker). */
  healGiven?: number;
  /** Σ HP others healed on Keech. */
  healTaken?: number;
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
  gotNoks?: number;
  kills: number;
  deaths: number;
  revives: number;
  vehicleKills?: number;
  vehicleLosses?: number;
};

export type KeechHuntLive = {
  updatedAt: string;
  match: KeechHuntMatch | null;
  matches?: KeechHuntMatch[];
  keechSteam: string;
  keechServer?: string | null;
  combat?: KeechHuntCombat;
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

const KILL_KINDS = new Set<KeechHuntEventKind>([
  "kill",
  "vehicle_kill",
  "driver_share",
]);
const DEATH_KINDS = new Set<KeechHuntEventKind>([
  "death",
  "self",
  "vehicle_loss",
  "vehicle_loss_driver",
]);

export function splitEvents(events: KeechHuntEvent[]) {
  const noks = events.filter((e) => e.kind === "nok");
  const gotNoks = events.filter((e) => e.kind === "gotnok");
  const kills = events.filter((e) => KILL_KINDS.has(e.kind));
  const deaths = events.filter((e) => DEATH_KINDS.has(e.kind));
  const revives = events.filter((e) => e.kind === "revive");
  return { noks, gotNoks, kills, deaths, revives };
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

/** `3/28 = 10.7%` — same formula as combat header (hits / shots × 100). */
export function formatAccSnap(e: {
  shots?: number;
  hits?: number;
  accuracyPct?: number | null;
  shotsKnown?: boolean;
  label?: string;
}): string {
  const hits = e.hits != null ? Number(e.hits) : NaN;
  if (e.shotsKnown === false || (e.label && /н\/д/.test(e.label))) {
    if (Number.isFinite(hits)) return ` · хиты ${hits} · выстрелы н/д`;
    return " · выстрелы н/д";
  }
  const shots = e.shots != null ? Number(e.shots) : NaN;
  if (Number.isFinite(shots) && Number.isFinite(hits) && shots >= 0) {
    if (e.accuracyPct != null && Number.isFinite(Number(e.accuracyPct))) {
      return ` · ${hits}/${shots} = ${Number(e.accuracyPct)}%`;
    }
    if (shots < 5) {
      return ` · ${hits}/${shots} (ждём 5+)`;
    }
    return ` · ${hits}/${shots}`;
  }
  if (e.label && /\d+\/\d+/.test(e.label)) {
    return ` · ${e.label}`;
  }
  return "";
}

/** Live-log / column display: who / what this RP is for. */
export function huntEventBody(e: KeechHuntEvent): {
  prefix: string;
  nick: string | null;
  suffix: string;
} {
  const d =
    (Number(e.delta) || 0) > 0
      ? `+${Math.round((Number(e.delta) || 0) * 10) / 10}`
      : String(Math.round((Number(e.delta) || 0) * 10) / 10);
  const soft =
    e.gainCoef != null && Number(e.gainCoef) > 0 && Number(e.gainCoef) < 1
      ? ` · soft×${Number(e.gainCoef)}`
      : "";
  if (e.kind === "nok")
    return { prefix: "Нокнул ", nick: e.nick, suffix: soft };
  if (e.kind === "gotnok")
    return { prefix: "Нокнул тебя ", nick: e.nick, suffix: "" };
  if (e.kind === "kill")
    return { prefix: "Убил ", nick: e.nick, suffix: ` · ${d} RP${soft}` };
  if (e.kind === "death")
    return { prefix: "Убит ", nick: e.nick, suffix: ` · ${d} RP` };
  if (e.kind === "revive")
    return { prefix: "Поднял ", nick: e.nick, suffix: ` · ${d} RP${soft}` };
  if (e.kind === "vehicle_kill")
    return {
      prefix: "Техника: ",
      nick: e.label || e.nick,
      suffix: ` · ${d} RP${soft}`,
    };
  if (e.kind === "vehicle_loss" || e.kind === "vehicle_loss_driver")
    return {
      prefix: "Потеря: ",
      nick: e.label || e.nick,
      suffix: ` · ${d} RP`,
    };
  if (e.kind === "driver_share")
    return {
      prefix: "Мехвод: ",
      nick: e.label || e.nick,
      suffix: ` · ${d} RP${soft}`,
    };
  if (e.kind === "hit") {
    const where = e.zone || "";
    const dmg =
      e.damage != null && Number(e.damage) > 0
        ? ` · ${Math.round(Number(e.damage))} dmg`
        : "";
    const acc = formatAccSnap(e);
    const zoneBit = where ? ` · ${where}` : "";
    return {
      prefix: "Попадание → ",
      nick: e.nick,
      suffix: `${zoneBit}${dmg}${acc}`,
    };
  }
  if (e.kind === "accuracy") {
    const acc = formatAccSnap(e) || (e.label ? ` · ${e.label}` : "");
    return {
      prefix: "Точность",
      nick: null,
      suffix: acc || " · —",
    };
  }
  if (e.kind === "gothit") {
    const where = e.zone || e.label || "";
    const dmg =
      e.damage != null && Number(e.damage) > 0
        ? ` · ${Math.round(Number(e.damage))} dmg`
        : "";
    return {
      prefix: "В тебя → ",
      nick: e.nick,
      suffix: where ? ` · ${where}${dmg}` : dmg,
    };
  }
  if (e.kind === "suppress") {
    const v =
      e.suppress != null && Number(e.suppress) > 0
        ? ` · ${Math.round(Number(e.suppress))}`
        : "";
    return { prefix: "Подавление → ", nick: e.nick, suffix: v };
  }
  if (e.kind === "gotsuppress") {
    const v =
      e.suppress != null && Number(e.suppress) > 0
        ? String(Math.round(Number(e.suppress)))
        : "";
    return {
      prefix: "Подавление на тебе",
      nick: null,
      suffix: v ? ` · ${v}` : "",
    };
  }
  if (e.kind === "heal") {
    const hp =
      e.heal != null && Number(e.heal) > 0
        ? ` · +${Math.round(Number(e.heal))} HP`
        : e.label
          ? ` · ${e.label}`
          : "";
    return { prefix: "Хил → ", nick: e.nick, suffix: hp };
  }
  if (e.kind === "gotheal") {
    const hp =
      e.heal != null && Number(e.heal) > 0
        ? ` · +${Math.round(Number(e.heal))} HP`
        : e.label
          ? ` · ${e.label}`
          : "";
    return { prefix: "Хил тебе ← ", nick: e.nick, suffix: hp };
  }
  return { prefix: `Сам · ${d} RP`, nick: null, suffix: "" };
}
