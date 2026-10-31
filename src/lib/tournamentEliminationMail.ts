/**
 * When a team loses a losers-bracket matchup they are out of Fruit Strike.
 * Send one thank-you letter to every registered participant of that team.
 */
import { loadFruitStrikeLive } from "@/lib/fruitStrikeLive";
import { prisma } from "@/lib/prisma";

const AUTHOR_STEAM = "76561198028435874";
const TOURNAMENT_ID = "fruit-strike-s1";
const SYNC_GAP_MS = 30_000;

/** Matches where the loser leaves the tournament (double-elim lower bracket). */
const ELIMINATION_MATCH_IDS = new Set([
  "l1",
  "l2",
  "r1",
  "r2",
  "ls",
  "lf",
]);

const TITLE = "Спасибо за участие в турнире";
const BODY = [
  "Администрация проекта bb-squad.ru благодарит за участие в турнире, надеемся вы получили интересный опыт и эмоции! Ждем Вас на следующих турнирах!",
  "Желаем Вам великих побед и хорошего настроения",
  "С Уважением Keech.",
].join("\n");

let syncedAt = 0;

async function userIdsForTeamTag(tag: string): Promise<string[]> {
  const team = await prisma.tournamentTeam.findFirst({
    where: { tag: { equals: tag, mode: "insensitive" } },
    select: { id: true },
  });
  if (!team) return [];

  const [entryPlayers, members] = await Promise.all([
    prisma.tournamentEntryPlayer.findMany({
      where: {
        entry: {
          tournamentId: TOURNAMENT_ID,
          teamId: team.id,
          status: "CONFIRMED",
        },
      },
      select: { userId: true },
    }),
    prisma.tournamentTeamMember.findMany({
      where: { teamId: team.id },
      select: { userId: true },
    }),
  ]);

  return [
    ...new Set([
      ...entryPlayers.map((r) => r.userId),
      ...members.map((r) => r.userId),
    ]),
  ];
}

async function addRecipients(mailId: string, userIds: string[]) {
  if (!userIds.length) return;
  const have = await prisma.profileMailRecipient.findMany({
    where: { mailId },
    select: { userId: true },
  });
  const known = new Set(have.map((r) => r.userId));
  const missing = userIds.filter((id) => !known.has(id));
  const chunk = 400;
  for (let i = 0; i < missing.length; i += chunk) {
    await prisma.profileMailRecipient.createMany({
      data: missing.slice(i, i + chunk).map((userId) => ({ mailId, userId })),
      skipDuplicates: true,
    });
  }
}

async function syncNow() {
  const live = await loadFruitStrikeLive();
  if (!live?.matches) return;

  const author = await prisma.user.findUnique({
    where: { steamId: AUTHOR_STEAM },
    select: { id: true },
  });
  if (!author) return;

  for (const [matchId, row] of Object.entries(live.matches)) {
    if (!ELIMINATION_MATCH_IDS.has(matchId)) continue;
    if (row?.status !== "done") continue;
    const loserTag = (row.loser?.tag || "").trim();
    if (!loserTag) continue;

    const sourceKey = `fs-elim:${TOURNAMENT_ID}:${matchId}:${loserTag.toUpperCase()}`;
    const existing = await prisma.profileMail.findUnique({
      where: { sourceKey },
      select: { id: true },
    });

    let mailId = existing?.id || "";
    if (!existing) {
      try {
        const created = await prisma.profileMail.create({
          data: {
            title: TITLE,
            body: BODY,
            senderKind: "admin",
            senderLabel: "Администрация",
            tags: ["Турнир"],
            sourceKey,
            authorId: author.id,
          },
          select: { id: true },
        });
        mailId = created.id;
        console.info(
          `tournament elim mail ${matchId} → ${loserTag} (${mailId})`
        );
      } catch {
        const again = await prisma.profileMail.findUnique({
          where: { sourceKey },
          select: { id: true },
        });
        mailId = again?.id || "";
      }
    }
    if (!mailId) continue;

    const userIds = await userIdsForTeamTag(loserTag);
    await addRecipients(mailId, userIds);
  }
}

/** Idempotent: one letter per eliminated team per losers-bracket match. */
export async function syncTournamentEliminationMails() {
  if (Date.now() - syncedAt < SYNC_GAP_MS) return;
  syncedAt = Date.now();
  try {
    await syncNow();
  } catch (err) {
    syncedAt = 0;
    console.error(
      "tournament elim mail",
      err instanceof Error ? err.message : "fail"
    );
  }
}
