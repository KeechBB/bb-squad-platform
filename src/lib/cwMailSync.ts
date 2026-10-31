import { prisma } from "@/lib/prisma";
import { upcomingCwMeetings, type CwAnnounce } from "@/lib/cwReady";
import { findBlackberryClanIds } from "@/lib/reserve";

const AUTHOR_STEAM = "76561198028435874";
const SYNC_GAP_MS = 60_000;

let syncedAt = 0;

function clanKey(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9А-ЯЁ]/g, "");
}

function letterOf(match: CwAnnounce) {
  const junior = match.stack === "Junior";
  const side = junior ? "BB Junior" : "BlackBerry";
  const note = junior
    ? "Играет BB Junior."
    : "Играет основной состав Main.";
  const title = `КВ · ${match.stack} играет · против ${match.opp} · ${match.dateLabel} ${match.timeMsk}`.slice(
    0,
    140
  );
  const body = [
    note,
    "",
    `${side} против ${match.opp}`,
    `Когда: ${match.dateLabel} · ${match.timeMsk} МСК`,
    `Карта: ${match.map}`,
    `Формат: ${match.size}`,
    `Сервер: ${match.server}`,
    `Правила: ${match.rules}`,
    "",
    "Игроки BlackBerry отмечаются «буду на КВ» здесь и на главной. Состав один и тот же.",
  ].join("\n");
  return { title, body, tags: ["КВ", match.stack] };
}

async function bbUserIds(): Promise<string[]> {
  const clanIds = await findBlackberryClanIds();
  if (!clanIds.length) return [];
  const members = await prisma.clanMember.findMany({
    where: { clanId: { in: clanIds } },
    select: { userId: true },
  });
  return [...new Set(members.map((m) => m.userId))];
}

/** Тег или имя клана с сайта (не карточка соперника со скринов) → id. */
async function siteClanByKey(): Promise<Map<string, string>> {
  const bbIds = new Set(await findBlackberryClanIds());
  const clans = await prisma.clan.findMany({
    where: { isExternal: false },
    select: { id: true, tag: true, name: true },
  });
  const byKey = new Map<string, string>();
  for (const clan of clans) {
    if (bbIds.has(clan.id)) continue;
    const name = clanKey(clan.name);
    const tag = clanKey(clan.tag);
    if (name) byKey.set(name, clan.id);
    if (tag) byKey.set(tag, clan.id);
  }
  return byKey;
}

async function memberIds(clanId: string, cache: Map<string, string[]>): Promise<string[]> {
  const hit = cache.get(clanId);
  if (hit) return hit;
  const rows = await prisma.clanMember.findMany({
    where: { clanId },
    select: { userId: true },
  });
  const ids = [...new Set(rows.map((row) => row.userId))];
  cache.set(clanId, ids);
  return ids;
}

async function addRecipients(mailId: string, userIds: string[]) {
  if (!userIds.length) return;
  const have = await prisma.profileMailRecipient.findMany({
    where: { mailId },
    select: { userId: true },
  });
  const known = new Set(have.map((row) => row.userId));
  const missing = userIds.filter((id) => !known.has(id));
  const chunk = 400;
  for (let i = 0; i < missing.length; i += chunk) {
    await prisma.profileMailRecipient.createMany({
      data: missing.slice(i, i + chunk).map((userId) => ({ mailId, userId })),
      skipDuplicates: true,
    });
  }
}

async function syncCwMailsNow() {
  const [author, meetings, userIds, oppClans] = await Promise.all([
    prisma.user.findUnique({
      where: { steamId: AUTHOR_STEAM },
      select: { id: true },
    }),
    upcomingCwMeetings(),
    bbUserIds(),
    siteClanByKey(),
  ]);
  if (!author || !userIds.length) return;
  const membersOf = new Map<string, string[]>();

  for (const match of meetings) {
    const sourceKey = `cw:${match.id}`;
    const letter = letterOf(match);
    const existing = await prisma.profileMail.findUnique({
      where: { sourceKey },
      select: { id: true, title: true, body: true, tags: true, cwMatchId: true },
    });
    let mailId = existing?.id || "";
    if (!existing) {
      try {
        const created = await prisma.profileMail.create({
          data: {
            title: letter.title,
            body: letter.body,
            senderKind: "custom",
            senderLabel: "Расписание КВ",
            tags: letter.tags,
            sourceKey,
            cwMatchId: match.id,
            authorId: author.id,
          },
          select: { id: true },
        });
        mailId = created.id;
      } catch {
        const again = await prisma.profileMail.findUnique({
          where: { sourceKey },
          select: { id: true },
        });
        mailId = again?.id || "";
      }
    } else {
      const same =
        existing.title === letter.title &&
        existing.body === letter.body &&
        existing.cwMatchId === match.id &&
        existing.tags.join("|") === letter.tags.join("|");
      if (!same) {
        await prisma.profileMail.update({
          where: { id: existing.id },
          data: {
            title: letter.title,
            body: letter.body,
            tags: letter.tags,
            cwMatchId: match.id,
            senderKind: "custom",
            senderLabel: "Расписание КВ",
          },
        });
      }
    }
    if (!mailId) continue;
    const oppId = oppClans.get(clanKey(match.opp));
    const oppIds = oppId ? await memberIds(oppId, membersOf) : [];
    await addRecipients(mailId, [...new Set([...userIds, ...oppIds])]);
  }
}

/** Одно письмо на встречу из расписания. Повтор ближе минуты ничего не пишет. */
export async function syncCwMails() {
  if (Date.now() - syncedAt < SYNC_GAP_MS) return;
  syncedAt = Date.now();
  try {
    await syncCwMailsNow();
  } catch (err) {
    syncedAt = 0;
    console.error("cw mail sync", err instanceof Error ? err.message : "fail");
  }
}
