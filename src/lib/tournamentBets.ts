import { promises as fs } from "fs";
import path from "path";
import { prisma } from "@/lib/prisma";
import { FRUIT_TEAMS_SEEDED } from "@/lib/fruitStrikeBracket";
import { loadFruitStrikeLive } from "@/lib/fruitStrikeLive";
import { fruitStrikeBetTruth } from "@/lib/fruitStrikeBetTruth";
import { ACTIVE_TOURNAMENT } from "@/lib/tournaments";
import {
  BET_POINTS,
  BET_QUESTIONS,
  BET_REVEAL_CLOSED,
  EMPTY_BET_SLIP,
  betAnswer,
  betFilledCount,
  betClosesAt,
  betMapOptions,
  betsClosed,
  gradeBetSlip,
  normalizeBlowout,
  type BetPlayer,
  type BetSlip,
  type BetTeam,
  type BetsPayload,
} from "@/lib/tournamentBetSlip";

const KEY_REL = path.join("data", "tournaments", "fruit-strike-s1-bet-key.json");

const TEAM_FIELDS = [
  "place1TeamId",
  "place2TeamId",
  "place3TeamId",
  "lowKdTeamId",
  "mostDeathsTeamId",
] as const;

const PLAYER_FIELDS = ["topKillsUserId", "topCutsUserId"] as const;

function slipFromRow(row: {
  place1TeamId: string | null;
  place2TeamId: string | null;
  place3TeamId: string | null;
  topKillsUserId: string | null;
  topCutsUserId: string | null;
  lowKdTeamId: string | null;
  killsOver2000: boolean | null;
  cutsOver500: boolean | null;
  mostDeathsTeamId: string | null;
  topKillsMap: string | null;
  blowoutScore: string | null;
}): BetSlip {
  return {
    place1TeamId: row.place1TeamId || "",
    place2TeamId: row.place2TeamId || "",
    place3TeamId: row.place3TeamId || "",
    topKillsUserId: row.topKillsUserId || "",
    topCutsUserId: row.topCutsUserId || "",
    lowKdTeamId: row.lowKdTeamId || "",
    killsOver2000: row.killsOver2000,
    cutsOver500: row.cutsOver500,
    mostDeathsTeamId: row.mostDeathsTeamId || "",
    topKillsMap: row.topKillsMap || "",
    blowoutScore: row.blowoutScore || "",
  };
}

async function loadAnswerKey(): Promise<Partial<BetSlip> | null> {
  try {
    const raw = await fs.readFile(path.join(process.cwd(), KEY_REL), "utf8");
    const json = JSON.parse(raw) as Partial<BetSlip>;
    if (!json || typeof json !== "object") return null;
    return json;
  } catch {
    return null;
  }
}

async function loadTeams(): Promise<BetTeam[]> {
  const tags = FRUIT_TEAMS_SEEDED.map((t) => t.tag);
  const rows = await prisma.tournamentTeam.findMany({
    where: { tag: { in: tags } },
    include: {
      entries: {
        where: { tournamentId: ACTIVE_TOURNAMENT.id, status: "CONFIRMED" },
        include: {
          players: {
            orderBy: [{ slot: "asc" }, { ord: "asc" }],
            include: { user: { select: { id: true, nick: true, steamId: true } } },
          },
        },
      },
    },
  });
  const byTag = new Map(rows.map((row) => [row.tag.toUpperCase(), row]));
  return FRUIT_TEAMS_SEEDED.map((seed, index) => {
    const row = byTag.get(seed.tag.toUpperCase());
    const entry = row?.entries[0];
    const players: BetPlayer[] = (entry?.players || []).map((p) => ({
      userId: p.user.id,
      nick: p.user.nick || p.user.steamId,
      href: p.user.nick ? `/players/${encodeURIComponent(p.user.nick)}` : null,
      slot: p.slot === "SUB" ? "SUB" : "STARTER",
    }));
    return {
      id: row?.id || "",
      name: row?.name || seed.name,
      tag: row?.tag || seed.tag,
      logoUrl: row?.logoUrl ?? null,
      seed: index + 1,
      players,
    };
  });
}

export async function tournamentBetsPayload(viewer: {
  id: string;
  profileComplete: boolean;
} | null): Promise<BetsPayload> {
  const [teams, bets, key, live] = await Promise.all([
    loadTeams(),
    prisma.tournamentBet.findMany({
      where: { tournamentId: ACTIVE_TOURNAMENT.id },
      include: { user: { select: { id: true, nick: true, steamName: true } } },
    }),
    loadAnswerKey(),
    loadFruitStrikeLive(),
  ]);
  const reveal = fruitStrikeBetTruth(live, teams, key);
  const answerKey = reveal.open ? reveal.answers : null;
  const locked = betsClosed(ACTIVE_TOURNAMENT.playDate);
  const mineRow = viewer ? bets.find((b) => b.user.id === viewer.id) : undefined;
  const graded = gradeBetSlip(EMPTY_BET_SLIP, answerKey).graded;
  const board = bets
    .map((row) => {
      const slip = slipFromRow(row);
      const score = gradeBetSlip(slip, answerKey);
      const nick = row.user.nick || row.user.steamName || "игрок";
      return {
        nick,
        href: row.user.nick ? `/players/${encodeURIComponent(row.user.nick)}` : null,
        filled: betFilledCount(slip),
        correct: score.correct,
        points: score.correct * BET_POINTS,
        mine: viewer?.id === row.user.id,
      };
    })
    .sort(
      (a, b) =>
        b.correct - a.correct || b.filled - a.filled || a.nick.localeCompare(b.nick, "ru")
    );

  return {
    locked,
    closesAt: betClosesAt(ACTIVE_TOURNAMENT.playDate).toISOString(),
    authed: Boolean(viewer?.profileComplete),
    needsProfile: Boolean(viewer && !viewer.profileComplete),
    pointsEach: BET_POINTS,
    lockNote: locked
      ? "Прогнозы закрыты. Срок был до 18:59 МСК."
      : "Прогноз можно сделать до 18:59 МСК.",
    tournamentName: ACTIVE_TOURNAMENT.name,
    graded,
    reveal: reveal.open ? reveal : BET_REVEAL_CLOSED,
    mine: mineRow ? slipFromRow(mineRow) : viewer?.profileComplete ? { ...EMPTY_BET_SLIP } : null,
    board,
    teams,
    maps: betMapOptions(),
  };
}

export function parseBetSlip(
  body: unknown,
  teams: BetTeam[]
): { slip: BetSlip } | { error: string } {
  const src = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const teamIds = new Set(teams.map((t) => t.id).filter(Boolean));
  const playerIds = new Set(teams.flatMap((t) => t.players.map((p) => p.userId)));
  const mapIds = new Set(betMapOptions().map((m) => m.id));
  const slip: BetSlip = { ...EMPTY_BET_SLIP };

  for (const field of TEAM_FIELDS) {
    const value = src[field];
    if (value == null || value === "") continue;
    if (typeof value !== "string" || !teamIds.has(value)) {
      return { error: "Выбери команду из сетки" };
    }
    slip[field] = value;
  }
  for (const field of PLAYER_FIELDS) {
    const value = src[field];
    if (value == null || value === "") continue;
    if (typeof value !== "string" || !playerIds.has(value)) {
      return { error: "Выбери игрока из заявки" };
    }
    slip[field] = value;
  }
  for (const field of ["killsOver2000", "cutsOver500"] as const) {
    const value = src[field];
    if (value == null || value === "") continue;
    if (typeof value !== "boolean") return { error: "Да или нет" };
    slip[field] = value;
  }
  if (src.topKillsMap != null && src.topKillsMap !== "") {
    if (typeof src.topKillsMap !== "string" || !mapIds.has(src.topKillsMap)) {
      return { error: "Выбери карту сетки" };
    }
    slip.topKillsMap = src.topKillsMap;
  }
  if (src.blowoutScore != null && String(src.blowoutScore).trim() !== "") {
    const score = normalizeBlowout(String(src.blowoutScore));
    if (!score) return { error: "Счёт раунда в виде 100-0" };
    slip.blowoutScore = score;
  }
  const places = [slip.place1TeamId, slip.place2TeamId, slip.place3TeamId].filter(Boolean);
  if (new Set(places).size !== places.length) {
    return { error: "На первое, второе и третье место нужны разные команды" };
  }
  const any = BET_QUESTIONS.some((q) => {
    const value = slip[q.field];
    return value !== "" && value !== null;
  });
  if (!any) return { error: "Заполни хотя бы один прогноз" };
  return { slip };
}

export async function saveTournamentBet(userId: string, body: unknown) {
  if (betsClosed(ACTIVE_TOURNAMENT.playDate)) {
    return { error: "Прогнозы закрыты в 18:59 МСК" as const };
  }
  const teams = await loadTeams();
  const parsed = parseBetSlip(body, teams);
  if ("error" in parsed) return { error: parsed.error };
  const slip = parsed.slip;
  const existing = await prisma.tournamentBet.findUnique({
    where: {
      tournamentId_userId: {
        tournamentId: ACTIVE_TOURNAMENT.id,
        userId,
      },
    },
  });
  if (existing) {
    const prev = slipFromRow(existing);
    const changed = BET_QUESTIONS.some((q) => {
      const was = betAnswer(prev, q.field);
      return was !== null && was !== betAnswer(slip, q.field);
    });
    if (changed) return { error: "Сданный прогноз менять нельзя" as const };
  }
  const data = {
    place1TeamId: slip.place1TeamId || null,
    place2TeamId: slip.place2TeamId || null,
    place3TeamId: slip.place3TeamId || null,
    topKillsUserId: slip.topKillsUserId || null,
    topCutsUserId: slip.topCutsUserId || null,
    lowKdTeamId: slip.lowKdTeamId || null,
    killsOver2000: slip.killsOver2000,
    cutsOver500: slip.cutsOver500,
    mostDeathsTeamId: slip.mostDeathsTeamId || null,
    topKillsMap: slip.topKillsMap || null,
    blowoutScore: slip.blowoutScore || null,
  };
  await prisma.tournamentBet.upsert({
    where: {
      tournamentId_userId: {
        tournamentId: ACTIVE_TOURNAMENT.id,
        userId,
      },
    },
    create: { tournamentId: ACTIVE_TOURNAMENT.id, userId, ...data },
    update: data,
  });
  return { ok: true as const };
}
