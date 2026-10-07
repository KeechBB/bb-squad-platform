/**
 * История матчей паблика (PB1) для профиля — аналог train match history.
 * Источник: slim public RP ladder (+ net) и опционально PublicMatch (счёт).
 */
import { prisma } from "@/lib/prisma";
import { loadPublicRpLadder, lookupPlayerPublicRp } from "@/lib/publicRp";
import { rpRankFromScore } from "@/lib/trainRp";
import type { TrainMatchHistoryRow } from "@/lib/homeTrainPwr";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function parseMatchId(id: string): {
  ymd: string;
  dateLabel: string;
  hm: string;
  mapSlug: string;
} | null {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})-(.+)$/i.exec(String(id || ""));
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return {
    ymd: `${m[1]}-${m[2]}-${m[3]}`,
    dateLabel: `${pad2(d)}.${pad2(mo)}.${y}`,
    hm: `${m[4]}:${m[5]}`,
    mapSlug: String(m[6] || "").toLowerCase().replace(/[^a-z0-9]+/g, ""),
  };
}

function mapSlugFromName(name: string): string {
  return String(name || "")
    .toLowerCase()
    .replace(/\s+(raas|aas|invasion|skirmish|tc|seed).*$/i, "")
    .replace(/[^a-z0-9]+/g, "");
}

type ScoreHit = {
  slug: string;
  faction1: string;
  score1: number;
  faction2: string;
  score2: number;
  winnerTeam: number;
};

async function loadPublicScoresByDay(
  ymds: string[]
): Promise<Map<string, ScoreHit[]>> {
  const uniq = [...new Set(ymds.filter(Boolean))];
  const out = new Map<string, ScoreHit[]>();
  if (!uniq.length) return out;

  const ors = uniq.map((ymd) => {
    const start = new Date(`${ymd}T00:00:00+03:00`);
    const end = new Date(`${ymd}T23:59:59.999+03:00`);
    return { endedAt: { gte: start, lte: end } };
  });

  const rows = await prisma.publicMatch.findMany({
    where: {
      AND: [
        {
          OR: [
            { serverKey: "TPUB1" },
            { serverKey: "PB1" },
            { serverKey: "PUB" },
          ],
        },
        { OR: ors },
      ],
    },
    select: {
      endedAt: true,
      mapName: true,
      layerName: true,
      faction1: true,
      score1: true,
      faction2: true,
      score2: true,
      winnerTeam: true,
    },
  });

  for (const r of rows) {
    const ymd = r.endedAt.toLocaleDateString("en-CA", {
      timeZone: "Europe/Moscow",
    });
    const list = out.get(ymd) || [];
    list.push({
      slug: mapSlugFromName(r.mapName || r.layerName || ""),
      faction1: r.faction1,
      score1: r.score1,
      faction2: r.faction2,
      score2: r.score2,
      winnerTeam: r.winnerTeam,
    });
    out.set(ymd, list);
  }
  return out;
}

function pickScore(
  dayHits: ScoreHit[],
  mapSlug: string,
  mapName: string
): ScoreHit | null {
  if (!dayHits?.length) return null;
  const want = mapSlug || mapSlugFromName(mapName);
  if (want) {
    const hit = dayHits.find(
      (h) => h.slug.includes(want) || want.includes(h.slug)
    );
    if (hit) return hit;
  }
  return dayHits.length === 1 ? dayHits[0] : null;
}

/** История PB1 матчей игрока с ΔRP (свежие сверху). */
export async function buildPlayerPublicMatchHistory(
  nick: string
): Promise<TrainMatchHistoryRow[]> {
  const clean = String(nick || "").trim();
  if (!clean) return [];

  const ladder = await loadPublicRpLadder();
  if (!ladder) return [];

  const player = await lookupPlayerPublicRp(clean);
  if (!player?.matches?.length) return [];

  const metaById = new Map(
    (ladder.matches || []).map((m) => [String(m.id), m] as const)
  );

  type SlimM = {
    id?: string;
    net?: number;
    won?: boolean | null;
    kills?: number | unknown;
    deaths?: number | unknown;
    map?: string;
    date?: string;
  };

  const rows = (player.matches as SlimM[])
    .filter((m) => m?.id)
    .map((m) => {
      const meta = metaById.get(String(m.id));
      const parsed = parseMatchId(String(m.id));
      return {
        id: String(m.id),
        date: String(m.date || meta?.date || parsed?.ymd || ""),
        map: String(m.map || meta?.map || "—"),
        net: Number(m.net),
        hasNet: m.net != null && Number.isFinite(Number(m.net)),
        won: m.won === true ? true : m.won === false ? false : null,
        parsed,
      };
    })
    .filter((m) => m.date);

  // хронология для running RP
  rows.sort((a, b) => {
    const ta = `${a.date}T${a.parsed?.hm || "00:00"}`;
    const tb = `${b.date}T${b.parsed?.hm || "00:00"}`;
    return ta.localeCompare(tb);
  });

  const ymds = rows.map((r) => r.date);
  let scores = new Map<string, ScoreHit[]>();
  try {
    scores = await loadPublicScoresByDay(ymds);
  } catch {
    scores = new Map();
  }

  const startRp = Number(ladder.startRp) || 1000;
  const step = Number(ladder.step) || 150;
  const radiant3Max = Number(ladder.radiant3Max) || 4500;
  let running = startRp;
  const canRunRp = rows.every((r) => r.hasNet);

  const history: TrainMatchHistoryRow[] = [];
  for (const m of rows) {
    let rpDelta: number | null = null;
    let rpAfter: number | null = null;
    let rankLabel = "—";
    let rankKey = "iron";
    if (canRunRp && m.hasNet) {
      rpDelta = Math.round(m.net);
      running = Math.round(running + m.net);
      rpAfter = running;
      const rk = rpRankFromScore(running, step, radiant3Max);
      rankLabel = rk.label;
      rankKey = rk.rankKey;
    } else if (m.hasNet) {
      rpDelta = Math.round(m.net);
    }

    const score = pickScore(
      scores.get(m.date) || [],
      m.parsed?.mapSlug || "",
      m.map
    );

    const dateLabel =
      m.parsed?.dateLabel ||
      (m.date.length >= 10
        ? `${m.date.slice(8, 10)}.${m.date.slice(5, 7)}.${m.date.slice(0, 4)}`
        : m.date);

    history.push({
      matchId: m.id,
      dateLabel,
      timeLabel: m.parsed?.hm || "—",
      map: m.map || "—",
      factionA: score ? String(score.faction1 || "—").toUpperCase() : "—",
      ticketsA: score ? score.score1 : null,
      factionB: score ? String(score.faction2 || "—").toUpperCase() : "—",
      ticketsB: score ? score.score2 : null,
      team: "—",
      winner: score
        ? score.winnerTeam === 1
          ? score.faction1
          : score.faction2
        : undefined,
      server: "PB1",
      playersUrl: "", // паблик: разбор через RP ledger, не KV players
      won: m.won,
      rpAfter,
      rpDelta,
      pwrAfter: rpAfter != null ? rpAfter : 0,
      pwrDelta: rpDelta != null ? rpDelta : 0,
      rankLabel,
      rankKey,
    });
  }

  return history.reverse();
}
