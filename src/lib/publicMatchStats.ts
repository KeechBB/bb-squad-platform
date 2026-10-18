/**
 * Public (PB1) match detail for ProfileMatchStatsModal — total + teamA/teamB.
 * Built from slim rp-ladder (no full ledger parse).
 */
import { pickMvps, type MvpBlock } from "@/lib/homeMvp";
import { abbreviateFaction } from "@/lib/factionAbbrev";
import { prisma } from "@/lib/prisma";
import { loadPublicRpLadder } from "@/lib/publicRp";
import { publicServerLabel } from "@/lib/publicMatches";

export type PublicMatchStatRow = {
  nick: string;
  res: number;
  nok: number;
  kills: number;
  /** Уничтоженная техника. Не входит в kills. */
  vehicleKills: number;
  deaths: number;
  dmg: number;
  kd: number;
  team?: string;
  net?: number;
};

export type PublicMatchStatsPayload = {
  ok: true;
  matchId: string;
  ledgerMatchId: string | null;
  title: string;
  sub: string;
  dateLabel: string;
  timeLabel: string;
  factionA: string;
  factionB: string;
  factionAAbbr: string;
  factionBAbbr: string;
  ticketsA: number;
  ticketsB: number;
  winnerTeam: number;
  teamA: PublicMatchStatRow[];
  teamB: PublicMatchStatRow[];
  players: PublicMatchStatRow[];
  mvp: { train: MvpBlock; public: MvpBlock };
  deltas: Record<string, number>;
};

function nickKey(n: string) {
  return String(n || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function countStat(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, Math.round(v));
  if (Array.isArray(v)) return v.length;
  return 0;
}

function kdOf(kills: number, deaths: number) {
  return deaths === 0 ? kills : Math.round((kills / deaths) * 100) / 100;
}

function mapBlob(...parts: (string | null | undefined)[]) {
  return parts
    .map((x) => String(x || "").toLowerCase())
    .join(" ")
    .replace(/[^a-z0-9а-яё\s-]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseLedgerId(id: string): { ymd: string; hm: string; slug: string } | null {
  const m = /^(\d{8})-(\d{4})-(.+)$/.exec(String(id || "").trim());
  if (!m) return null;
  return { ymd: m[1], hm: m[2], slug: m[3].toLowerCase() };
}

function mskYmd(iso: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(iso)
    .replace(/-/g, "");
}

function mskHm(iso: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(iso);
  const h = parts.find((p) => p.type === "hour")?.value || "00";
  const mi = parts.find((p) => p.type === "minute")?.value || "00";
  return `${h}${mi}`;
}

function mskDateLabel(iso: Date): string {
  return iso.toLocaleDateString("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function mskTimeLabel(iso: Date): string {
  return iso.toLocaleTimeString("ru-RU", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function hmDiffMinutes(a: string, b: string): number {
  const toMin = (hm: string) => {
    const h = Number(hm.slice(0, 2)) || 0;
    const m = Number(hm.slice(2, 4)) || 0;
    return h * 60 + m;
  };
  return Math.abs(toMin(a) - toMin(b));
}

function factionLabel(side: string | null | undefined, unit: string | null | undefined, fallback: string) {
  const s = String(side || "").trim();
  if (s) return s;
  const u = String(unit || "").trim();
  if (u) return u;
  return fallback;
}

type SlimMatch = { id?: string; date?: string; map?: string; score1?: number; score2?: number };

function pickLedgerMatchId(
  endedAt: Date,
  mapName: string,
  layerName: string | null,
  score1: number,
  score2: number,
  ladderMatches: SlimMatch[]
): string | null {
  const ymd = mskYmd(endedAt);
  const hm = mskHm(endedAt);
  const blob = mapBlob(mapName, layerName);
  let best: string | null = null;
  let bestScore = 1e12;

  for (const m of ladderMatches) {
    const id = String(m.id || "");
    if (!id) continue;
    const parsed = parseLedgerId(id);
    const dateOk =
      (parsed && parsed.ymd === ymd) ||
      String(m.date || "").replace(/-/g, "") === ymd;
    if (!dateOk) continue;

    const mapStr = mapBlob(m.map, parsed?.slug);
    const mapHit =
      !blob ||
      !mapStr ||
      blob.includes(mapStr) ||
      mapStr.includes(blob.split(" ")[0] || "") ||
      (parsed?.slug && blob.includes(parsed.slug.replace(/-/g, " ")));
    if (!mapHit && parsed?.slug) {
      const slugToks = parsed.slug.split("-").filter((t) => t.length > 2);
      if (!slugToks.some((t) => blob.includes(t))) continue;
    } else if (!mapHit) {
      continue;
    }

    let score = 0;
    if (parsed) {
      const dt = hmDiffMinutes(parsed.hm, hm);
      if (dt > 45) continue;
      score += dt;
    } else {
      score += 30;
    }
    if (m.score1 != null && m.score2 != null) {
      if (Number(m.score1) !== score1 || Number(m.score2) !== score2) {
        score += 500;
      }
    }
    if (score < bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
}

export async function buildPublicMatchStats(
  matchId: string
): Promise<PublicMatchStatsPayload | { ok: false; error: string }> {
  const id = String(matchId || "").trim();
  if (!id) return { ok: false, error: "matchId required" };

  const row = await prisma.publicMatch.findUnique({ where: { id } });
  if (!row) return { ok: false, error: "not_found" };

  const ladder = await loadPublicRpLadder();
  if (!ladder?.players) {
    return { ok: false, error: "no_ladder" };
  }

  const ledgerMatchId = pickLedgerMatchId(
    row.endedAt,
    row.mapName,
    row.layerName,
    row.score1,
    row.score2,
    (ladder.matches || []) as SlimMatch[]
  );

  const teamA: PublicMatchStatRow[] = [];
  const teamB: PublicMatchStatRow[] = [];
  const unknown: PublicMatchStatRow[] = [];
  const deltas: Record<string, number> = {};

  if (ledgerMatchId) {
    for (const p of Object.values(ladder.players)) {
      const nick = String(p.nick || "").trim();
      if (!nick) continue;
      const hit = (p.matches || []).find((m) => String(m.id) === ledgerMatchId);
      if (!hit) continue;
      const vehicleKills = countStat(
        (hit as { vehicleKills?: number }).vehicleKills
      );
      const rawKills = countStat(hit.kills);
      // Старый ladder: len(die+vehicle_kill+driver_share). Технику вычитаем.
      const kills = (hit as { giveupKills?: boolean }).giveupKills
        ? rawKills
        : Math.max(0, rawKills - vehicleKills);
      const deaths = countStat(hit.deaths);
      const res = countStat(hit.revives);
      const nok = countStat(hit.noks);
      const dmg = Math.round(Number(hit.dmg) || 0);
      const net = Math.round((Number((hit as { net?: number }).net) || 0) * 10) / 10;
      const stat: PublicMatchStatRow = {
        nick,
        kills,
        vehicleKills,
        deaths,
        res,
        nok,
        dmg,
        kd: kdOf(kills, deaths),
        net,
      };
      deltas[nick.trim().toLowerCase()] = net;
      // won=true → winning team (1→A / 2→B); unknown winner → keep in total only
      if (hit.won === true && row.winnerTeam === 1) {
        stat.team = "1";
        teamA.push(stat);
      } else if (hit.won === true && row.winnerTeam === 2) {
        stat.team = "2";
        teamB.push(stat);
      } else if (hit.won === false && row.winnerTeam === 1) {
        stat.team = "2";
        teamB.push(stat);
      } else if (hit.won === false && row.winnerTeam === 2) {
        stat.team = "1";
        teamA.push(stat);
      } else {
        unknown.push(stat);
      }
    }
  }

  const dedupe = (rows: PublicMatchStatRow[]) => {
    const seen = new Set<string>();
    return rows.filter((r) => {
      const k = nickKey(r.nick);
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  const teamAClean = dedupe(teamA);
  const teamBClean = dedupe(teamB);
  const unknownClean = dedupe(unknown);
  const players = [...teamAClean, ...teamBClean, ...unknownClean];
  // If sides unknown and everyone went to A, keep as total-only split empty B
  const mvpBlock = pickMvps(
    players.map((p) => ({
      nick: p.nick,
      res: p.res,
      nok: p.nok,
      kills: p.kills,
      deaths: p.deaths,
      dmg: p.dmg,
    }))
  );

  const factionA = factionLabel(row.faction1Side, row.faction1, "Команда 1");
  const factionB = factionLabel(row.faction2Side, row.faction2, "Команда 2");
  const abbrA = abbreviateFaction(factionA);
  const abbrB = abbreviateFaction(factionB);
  const server = publicServerLabel(row.serverKey);
  const dateLabel = mskDateLabel(row.endedAt);
  const timeLabel = mskTimeLabel(row.endedAt);
  const winAbbr =
    row.winnerTeam === 1 ? abbrA : row.winnerTeam === 2 ? abbrB : "—";

  return {
    ok: true,
    matchId: row.id,
    ledgerMatchId,
    title: `${dateLabel} · ${row.mapName}`,
    sub: `${row.layerName || row.mapName} · ${server} · ${abbrA} ${row.score1}:${row.score2} ${abbrB} · ${winAbbr}`,
    dateLabel,
    timeLabel,
    factionA,
    factionB,
    factionAAbbr: abbrA,
    factionBAbbr: abbrB,
    ticketsA: row.score1,
    ticketsB: row.score2,
    winnerTeam: row.winnerTeam,
    teamA: teamAClean,
    teamB: teamBClean,
    players,
    mvp: { train: mvpBlock, public: mvpBlock },
    deltas,
  };
}
