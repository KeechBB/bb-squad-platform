/**
 * Официальные ответы прогноза.
 * Открываются только когда известен чемпион — победитель гранд-финала.
 * Места и самый разгромный раунд считаются из сетки.
 * Киллы, разрезы, KD и карта — из статистики турнира, если она уже есть.
 */
import type { FruitLiveMatch, FruitLiveState } from "@/lib/fruitStrikeLiveView";
import {
  BET_QUESTIONS,
  BET_REVEAL_CLOSED,
  betMapOptions,
  blowoutKey,
  type BetField,
  type BetReveal,
  type BetSlip,
  type BetTeam,
} from "@/lib/tournamentBetSlip";

type Loose = Record<string, unknown>;

function asRecord(v: unknown): Loose | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Loose;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function findTeam(teams: BetTeam[], tag?: string, name?: string): BetTeam | null {
  const t = (tag || "").trim().toUpperCase();
  const n = (name || "").trim().toUpperCase();
  if (t) {
    const byTag = teams.find((team) => team.id && team.tag.toUpperCase() === t);
    if (byTag) return byTag;
  }
  if (n) {
    const byName = teams.find((team) => team.id && team.name.toUpperCase() === n);
    if (byName) return byName;
  }
  return null;
}

function findPlayer(teams: BetTeam[], nick?: string, userId?: string) {
  if (userId) {
    for (const team of teams) {
      const hit = team.players.find((p) => p.userId === userId);
      if (hit) return hit;
    }
  }
  const n = (nick || "").trim().toLowerCase();
  if (!n) return null;
  const hits = teams.flatMap((team) =>
    team.players.filter((p) => p.nick.trim().toLowerCase() === n)
  );
  return hits.length === 1 ? hits[0] : null;
}

function mapLabel(id: string): string | null {
  const hit = betMapOptions().find((m) => m.id === id);
  return hit ? hit.label : null;
}

function championKnown(live: FruitLiveState | null): FruitLiveMatch | null {
  const gf = live?.matches?.gf;
  if (!gf || gf.status !== "done") return null;
  if (!gf.winner?.tag && !gf.winner?.name) return null;
  return gf;
}

function worstRound(live: FruitLiveState): string | null {
  let bestDiff = -1;
  let bestHi = -1;
  let best = "";
  for (const row of Object.values(live.matches || {})) {
    if (row?.status !== "done") continue;
    for (const round of [row.r1, row.r2]) {
      if (!round) continue;
      const a = round.ticketsA;
      const b = round.ticketsB;
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      const hi = Math.max(a, b);
      const lo = Math.min(a, b);
      const diff = hi - lo;
      if (diff > bestDiff || (diff === bestDiff && hi > bestHi)) {
        bestDiff = diff;
        bestHi = hi;
        best = `${hi}-${lo}`;
      }
    }
  }
  return bestDiff >= 0 ? best : null;
}

export function fruitStrikeBetTruth(
  live: FruitLiveState | null,
  teams: BetTeam[],
  key: Partial<BetSlip> | null
): BetReveal {
  const gf = championKnown(live);
  if (!gf || !live) return BET_REVEAL_CLOSED;

  const answers: Partial<BetSlip> = {};
  const lines: Partial<Record<BetField, string>> = {};

  const put = (field: BetField, value: BetSlip[BetField], line: string) => {
    if (value === "" || value == null) return;
    (answers as Record<string, BetSlip[BetField]>)[field] = value;
    lines[field] = line;
  };

  const empty = (field: BetField) => {
    const value = answers[field];
    return value === undefined || value === null || value === "";
  };

  const place1 = findTeam(teams, gf.winner?.tag, gf.winner?.name);
  const place2 = findTeam(teams, gf.loser?.tag, gf.loser?.name);
  const lf = live.matches?.lf;
  const place3 =
    lf?.status === "done" ? findTeam(teams, lf.loser?.tag, lf.loser?.name) : null;

  if (place1) put("place1TeamId", place1.id, place1.name);
  if (place2 && place2.id !== place1?.id) put("place2TeamId", place2.id, place2.name);
  if (place3 && place3.id !== place1?.id && place3.id !== place2?.id) {
    put("place3TeamId", place3.id, place3.name);
  }

  const blowout = worstRound(live);
  if (blowout) put("blowoutScore", blowout, blowout);

  const facts = asRecord((live as { facts?: unknown }).facts) || asRecord((live as { betFacts?: unknown }).betFacts);
  const players = (live.playerStats || []).map((row) => asRecord(row)).filter((row): row is Loose => Boolean(row));
  const teamRows = (live.teamStats || []).map((row) => asRecord(row)).filter((row): row is Loose => Boolean(row));

  const killRows = players.filter((row) => num(row.kills) != null);
  if (killRows.length) {
    let top: Loose | null = null;
    let topKills = -1;
    let total = 0;
    const deathsByTag = new Map<string, { tag: string; name: string; deaths: number; kills: number }>();
    const killsByMap = new Map<string, number>();
    for (const row of killRows) {
      const kills = num(row.kills) ?? 0;
      const deaths = num(row.deaths) ?? 0;
      total += kills;
      if (kills > topKills) {
        topKills = kills;
        top = row;
      }
      const tag = str(row.teamTag) || str(row.tag);
      if (tag) {
        const slot = deathsByTag.get(tag.toUpperCase()) || {
          tag,
          name: str(row.teamName) || str(row.name),
          deaths: 0,
          kills: 0,
        };
        slot.deaths += deaths;
        slot.kills += kills;
        deathsByTag.set(tag.toUpperCase(), slot);
      }
      const map = str(row.map);
      if (map) killsByMap.set(map, (killsByMap.get(map) || 0) + kills);
    }
    if (top && topKills > 0) {
      const nick = str(top.nick);
      const player = findPlayer(teams, nick, str(top.userId));
      const line = `${player?.nick || nick} · ${topKills} киллов`;
      if (player) put("topKillsUserId", player.userId, line);
      else if (nick) lines.topKillsUserId = line;
    }
    if (total > 0) {
      put("killsOver2000", total > 2000, `${total > 2000 ? "Да" : "Нет"} · ${total} убийств`);
    }
    let deathTop: { tag: string; name: string; deaths: number } | null = null;
    let kdLow: { tag: string; name: string; kd: number } | null = null;
    for (const slot of deathsByTag.values()) {
      if (!deathTop || slot.deaths > deathTop.deaths) deathTop = slot;
      if (slot.deaths > 0) {
        const kd = slot.kills / slot.deaths;
        if (!kdLow || kd < kdLow.kd) kdLow = { tag: slot.tag, name: slot.name, kd };
      }
    }
    if (deathTop && deathTop.deaths > 0) {
      const team = findTeam(teams, deathTop.tag, deathTop.name);
      if (team) put("mostDeathsTeamId", team.id, `${team.name} · ${deathTop.deaths} смертей`);
    }
    if (kdLow) {
      const team = findTeam(teams, kdLow.tag, kdLow.name);
      if (team) put("lowKdTeamId", team.id, `${team.name} · KD ${kdLow.kd.toFixed(2)}`);
    }
    let mapBest = "";
    let mapKills = -1;
    for (const [map, kills] of killsByMap) {
      if (kills > mapKills && mapLabel(map)) {
        mapKills = kills;
        mapBest = map;
      }
    }
    if (mapBest && mapKills > 0) {
      put("topKillsMap", mapBest, `${mapLabel(mapBest)} · ${mapKills} киллов`);
    }
  }

  const cutRows = players.filter((row) => num(row.cuts) != null || num(row.melee) != null);
  if (cutRows.length) {
    let top: Loose | null = null;
    let topCuts = -1;
    let total = 0;
    for (const row of cutRows) {
      const cuts = num(row.cuts) ?? num(row.melee) ?? 0;
      total += cuts;
      if (cuts > topCuts) {
        topCuts = cuts;
        top = row;
      }
    }
    if (top && topCuts > 0) {
      const nick = str(top.nick);
      const player = findPlayer(teams, nick, str(top.userId));
      const line = `${player?.nick || nick} · ${topCuts} разрезов`;
      if (player) put("topCutsUserId", player.userId, line);
      else if (nick) lines.topCutsUserId = line;
    }
    if (total > 0) {
      put("cutsOver500", total > 500, `${total > 500 ? "Да" : "Нет"} · ${total} разрезов`);
    }
  }

  if (empty("lowKdTeamId")) {
    let low: { tag: string; name: string; kd: number } | null = null;
    for (const row of teamRows) {
      const kd = num(row.avgKd);
      if (kd == null || kd <= 0) continue;
      const tag = str(row.tag);
      const name = str(row.name);
      if (!low || kd < low.kd) low = { tag, name, kd };
    }
    if (low) {
      const team = findTeam(teams, low.tag, low.name);
      if (team) put("lowKdTeamId", team.id, `${team.name} · KD ${low.kd.toFixed(2)}`);
    }
  }

  const fillFact = (field: BetField, value: BetSlip[BetField] | undefined, line: string | null) => {
    if (!empty(field) || value == null || value === "" || !line) return;
    put(field, value, line);
  };

  if (facts) {
    const killsTotal = num(facts.killsTotal);
    if (killsTotal != null) {
      fillFact("killsOver2000", killsTotal > 2000, `${killsTotal > 2000 ? "Да" : "Нет"} · ${killsTotal} убийств`);
    }
    const cutsTotal = num(facts.cutsTotal);
    if (cutsTotal != null) {
      fillFact("cutsOver500", cutsTotal > 500, `${cutsTotal > 500 ? "Да" : "Нет"} · ${cutsTotal} разрезов`);
    }
    const topKills = findPlayer(teams, str(facts.topKillsNick), str(facts.topKillsUserId));
    const topKillsN = num(facts.topKills);
    if (topKills) {
      fillFact(
        "topKillsUserId",
        topKills.userId,
        topKillsN != null ? `${topKills.nick} · ${topKillsN} киллов` : topKills.nick
      );
    }
    const topCuts = findPlayer(teams, str(facts.topCutsNick), str(facts.topCutsUserId));
    const topCutsN = num(facts.topCuts);
    if (topCuts) {
      fillFact(
        "topCutsUserId",
        topCuts.userId,
        topCutsN != null ? `${topCuts.nick} · ${topCutsN} разрезов` : topCuts.nick
      );
    }
    const lowTeam = findTeam(teams, str(facts.lowKdTag), str(facts.lowKdName));
    const lowKd = num(facts.lowKd);
    if (lowTeam) {
      fillFact("lowKdTeamId", lowTeam.id, lowKd != null ? `${lowTeam.name} · KD ${lowKd.toFixed(2)}` : lowTeam.name);
    }
    const deathTeam = findTeam(teams, str(facts.mostDeathsTag), str(facts.mostDeathsName));
    const deaths = num(facts.mostDeaths);
    if (deathTeam) {
      fillFact(
        "mostDeathsTeamId",
        deathTeam.id,
        deaths != null ? `${deathTeam.name} · ${deaths} смертей` : deathTeam.name
      );
    }
    const mapId = str(facts.topKillsMap);
    const mapKills = num(facts.topKillsMapCount);
    if (mapId && mapLabel(mapId)) {
      fillFact(
        "topKillsMap",
        mapId,
        mapKills != null ? `${mapLabel(mapId)} · ${mapKills} киллов` : mapLabel(mapId)!
      );
    }
    const factBlow = blowoutKey(str(facts.blowoutScore));
    if (factBlow) fillFact("blowoutScore", factBlow, factBlow);
  }

  if (key) {
    for (const q of BET_QUESTIONS) {
      if (!empty(q.field)) continue;
      const value = key[q.field];
      if (value === undefined || value === null || value === "") continue;
      if (q.kind === "team" && typeof value === "string") {
        const team = teams.find((t) => t.id === value);
        if (team) put(q.field, team.id, team.name);
      } else if (q.kind === "player" && typeof value === "string") {
        const player = findPlayer(teams, undefined, value);
        if (player) put(q.field, player.userId, player.nick);
      } else if (q.kind === "yn" && typeof value === "boolean") {
        put(q.field, value, value ? "Да" : "Нет");
      } else if (q.kind === "map" && typeof value === "string" && mapLabel(value)) {
        put(q.field, value, mapLabel(value)!);
      } else if (q.kind === "score" && typeof value === "string") {
        const score = blowoutKey(value);
        if (score) put(q.field, score, score);
      }
    }
  }

  return {
    open: true,
    champion: place1?.name || gf.winner?.name || gf.winner?.tag || null,
    answers,
    lines,
  };
}
