/**
 * Снимок прогнозов турнира на диск plaza — для поздней статистики.
 * Канон: Postgres TournamentBet; архив — читаемые лейблы + tallies.
 */
import { promises as fs } from "fs";
import path from "path";
import { prisma } from "@/lib/prisma";
import { FRUIT_TEAMS_SEEDED } from "@/lib/fruitStrikeBracket";
import { ACTIVE_TOURNAMENT } from "@/lib/tournaments";
import {
  BET_QUESTIONS,
  betFilledCount,
  betMapOptions,
  type BetField,
  type BetSlip,
} from "@/lib/tournamentBetSlip";

const ARCHIVE_REL = path.join(
  "data",
  "tournaments",
  `${ACTIVE_TOURNAMENT.id}-bets-archive.json`
);

type Labeled = { id: string; label: string };

type ArchiveBet = {
  userId: string;
  nick: string;
  steamId: string | null;
  createdAt: string;
  updatedAt: string;
  filled: number;
  raw: Record<string, string | boolean | null>;
  labeled: Partial<Record<BetField, Labeled | boolean | string>>;
};

export type TournamentBetArchive = {
  tournamentId: string;
  tournamentName: string;
  exportedAt: string;
  betsCount: number;
  questions: Array<{ field: BetField; title: string; kind: string }>;
  bets: ArchiveBet[];
  /** Сколько раз выбрали каждый вариант (по лейблу). */
  tallies: Partial<Record<BetField, Record<string, number>>>;
};

function archivePath(): string {
  return path.join(process.cwd(), ARCHIVE_REL);
}

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

function bump(
  tallies: Partial<Record<BetField, Record<string, number>>>,
  field: BetField,
  key: string
) {
  if (!key) return;
  const bag = tallies[field] || (tallies[field] = {});
  bag[key] = (bag[key] || 0) + 1;
}

/** Пересобрать архив из Postgres → data/tournaments/<id>-bets-archive.json */
export async function rebuildTournamentBetArchive(
  tournamentId = ACTIVE_TOURNAMENT.id
): Promise<TournamentBetArchive> {
  const tags = FRUIT_TEAMS_SEEDED.map((t) => t.tag);
  const [bets, teamRows] = await Promise.all([
    prisma.tournamentBet.findMany({
      where: { tournamentId },
      include: {
        user: { select: { id: true, nick: true, steamName: true, steamId: true } },
      },
      orderBy: { updatedAt: "asc" },
    }),
    prisma.tournamentTeam.findMany({
      where: { tag: { in: tags } },
      select: { id: true, name: true, tag: true },
    }),
  ]);

  const playerIds = [
    ...new Set(
      bets.flatMap((r) =>
        [r.topKillsUserId, r.topCutsUserId].filter(Boolean) as string[]
      )
    ),
  ];
  const players = playerIds.length
    ? await prisma.user.findMany({
        where: { id: { in: playerIds } },
        select: { id: true, nick: true, steamName: true },
      })
    : [];

  const teamById = new Map(
    teamRows.map((t) => [
      t.id,
      { id: t.id, label: `${t.tag} · ${t.name}` },
    ] as const)
  );
  const playerById = new Map(
    players.map((u) => [
      u.id,
      { id: u.id, label: u.nick || u.steamName || u.id },
    ] as const)
  );
  const mapLabel = new Map(betMapOptions().map((m) => [m.id, m.label]));

  const tallies: TournamentBetArchive["tallies"] = {};
  const outBets: ArchiveBet[] = [];

  for (const row of bets) {
    const slip = slipFromRow(row);
    const raw: ArchiveBet["raw"] = {
      place1TeamId: row.place1TeamId,
      place2TeamId: row.place2TeamId,
      place3TeamId: row.place3TeamId,
      topKillsUserId: row.topKillsUserId,
      topCutsUserId: row.topCutsUserId,
      lowKdTeamId: row.lowKdTeamId,
      killsOver2000: row.killsOver2000,
      cutsOver500: row.cutsOver500,
      mostDeathsTeamId: row.mostDeathsTeamId,
      topKillsMap: row.topKillsMap,
      blowoutScore: row.blowoutScore,
    };
    const labeled: ArchiveBet["labeled"] = {};

    for (const q of BET_QUESTIONS) {
      const field = q.field;
      if (q.kind === "team") {
        const id = String(slip[field] || "");
        if (!id) continue;
        const lab = teamById.get(id) || { id, label: id };
        labeled[field] = lab;
        bump(tallies, field, lab.label);
      } else if (q.kind === "player") {
        const id = String(slip[field] || "");
        if (!id) continue;
        const lab = playerById.get(id) || { id, label: id };
        labeled[field] = lab;
        bump(tallies, field, lab.label);
      } else if (q.kind === "yn") {
        const v = slip[field];
        if (v === null || v === "") continue;
        const label = v === true ? "да" : "нет";
        labeled[field] = Boolean(v);
        bump(tallies, field, label);
      } else if (q.kind === "map") {
        const id = String(slip[field] || "");
        if (!id) continue;
        const label = mapLabel.get(id) || id;
        labeled[field] = { id, label };
        bump(tallies, field, label);
      } else if (q.kind === "score") {
        const score = String(slip[field] || "").trim();
        if (!score) continue;
        labeled[field] = score;
        bump(tallies, field, score);
      }
    }

    outBets.push({
      userId: row.userId,
      nick: row.user.nick || row.user.steamName || "игрок",
      steamId: row.user.steamId || null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      filled: betFilledCount(slip),
      raw,
      labeled,
    });
  }

  const archive: TournamentBetArchive = {
    tournamentId,
    tournamentName: ACTIVE_TOURNAMENT.name,
    exportedAt: new Date().toISOString(),
    betsCount: outBets.length,
    questions: BET_QUESTIONS.map((q) => ({
      field: q.field,
      title: q.title,
      kind: q.kind,
    })),
    bets: outBets,
    tallies,
  };

  const file = archivePath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(archive, null, 2), "utf8");
  await fs.rename(tmp, file);
  return archive;
}

/** Не блокирует сейв прогноза. */
export function kickTournamentBetArchive(): void {
  void rebuildTournamentBetArchive().catch((e) => {
    console.warn("[tournamentBetArchive] rebuild failed", e);
  });
}

export function tournamentBetArchiveRelPath(): string {
  return ARCHIVE_REL.replace(/\\/g, "/");
}
