/**
 * СРИ — Система Распределения Игроков.
 * Свободный агент = в BB · не резерв · нет FactionMember · не Keech.
 * Баланс по 5 пехотным фракциям (без Легиона).
 */
import { prisma } from "@/lib/prisma";
import { isBuiltinSuperAdmin } from "@/lib/admin";
import { personLabel, writeActionLog } from "@/lib/actionLog";
import { logFaction } from "@/lib/factions";
import { isActiveReserve } from "@/lib/validation";
import { formatMskYmd } from "@/lib/squadHits";

export const SRI_SENDER_KIND = "sri";
export const SRI_SENDER_LABEL = "СРИ";

/** Пехотные фракции для автобаланса. Легион — вне пула. */
export const SRI_FACTION_NAMES = ["Орда", "Улей", "Сброд", "Стая", "Табор"] as const;

export type SriReason = "recruit" | "reserve_exit" | "balance_batch";

const REASON_RU: Record<SriReason, string> = {
  recruit: "новичок после набора (recruit-bot: сайт + инфо + общий чат)",
  reserve_exit: "игрок после выхода с резерва",
  balance_batch: "разовая балансировка свободных агентов",
};

function mskDateTimeLabel(d = new Date()): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d);
}

async function keechUser() {
  const bySteam = await prisma.user.findFirst({
    where: { steamId: "76561198028435874" },
    select: { id: true, nick: true, name: true, steamName: true, steamId: true },
  });
  if (bySteam) return bySteam;
  return prisma.user.findFirst({
    where: { nick: { equals: "Keech", mode: "insensitive" } },
    select: { id: true, nick: true, name: true, steamName: true, steamId: true },
  });
}

export async function listSriFactions() {
  const bb = await prisma.clan.findFirst({
    where: { tag: "BB", isExternal: false },
    select: { id: true },
  });
  if (!bb) return [];
  const factions = await prisma.faction.findMany({
    where: {
      clanId: bb.id,
      name: { in: [...SRI_FACTION_NAMES] },
    },
    select: {
      id: true,
      name: true,
      slug: true,
      clanId: true,
      _count: { select: { members: true } },
      members: {
        where: { seat: { in: ["LEADER", "DEPUTY"] } },
        select: {
          seat: true,
          userId: true,
          user: { select: { id: true, nick: true } },
        },
      },
    },
  });
  return factions.map((f) => ({
    id: f.id,
    name: f.name,
    slug: f.slug,
    clanId: f.clanId,
    count: f._count.members,
    leaderIds: f.members.filter((m) => m.seat === "LEADER").map((m) => m.userId),
    deputyIds: f.members.filter((m) => m.seat === "DEPUTY").map((m) => m.userId),
  }));
}

/** Шлак (ручной список Alex) — не автораздавать СРИ. */
export const SRI_SLAG_NICKS = new Set(["maskey", "alafolix", "ready"]);

function isSlagNick(nick: string | null | undefined): boolean {
  const n = (nick || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е");
  return SRI_SLAG_NICKS.has(n);
}

/** Свободные агенты: BB · не RESERVE · нет фракции · не Keech · не шлак. */
export async function listFreeAgents() {
  const bb = await prisma.clan.findFirst({
    where: { tag: "BB", isExternal: false },
    select: { id: true },
  });
  if (!bb) return [];
  const now = new Date();
  const members = await prisma.clanMember.findMany({
    where: {
      clanId: bb.id,
      role: { not: "RESERVE" },
      user: { factionMembership: { is: null } },
    },
    select: {
      role: true,
      user: {
        select: {
          id: true,
          nick: true,
          name: true,
          steamName: true,
          steamId: true,
          reserveUntil: true,
          telegram: true,
        },
      },
    },
  });
  return members
    .map((m) => m.user)
    .filter((u) => {
      if (!u.steamId || isBuiltinSuperAdmin(u.steamId)) return false;
      if (isActiveReserve(u.reserveUntil)) return false;
      const nick = (u.nick || "").trim().toLowerCase();
      if (nick === "keech" || nick === "кич") return false;
      if (isSlagNick(u.nick) || isSlagNick(u.steamName)) return false;
      return true;
    })
    .map((u) => ({
      id: u.id,
      nick: personLabel(u),
      steamId: u.steamId,
    }))
    .sort((a, b) => a.nick.localeCompare(b.nick, "ru"));
}

function pickLightest(
  factions: { id: string; name: string; count: number }[]
): { id: string; name: string; count: number } | null {
  if (!factions.length) return null;
  const sorted = [...factions].sort(
    (a, b) => a.count - b.count || a.name.localeCompare(b.name, "ru")
  );
  return sorted[0] || null;
}

async function sendSriMail(opts: {
  authorId: string;
  recipientIds: string[];
  playerNick: string;
  factionName: string;
  reason: SriReason;
  when: Date;
  sourceKey: string;
}) {
  const ids = [...new Set(opts.recipientIds.filter(Boolean))];
  if (!ids.length) return null;
  const whenLabel = mskDateTimeLabel(opts.when);
  const title = `СРИ · ${opts.playerNick} → ${opts.factionName}`;
  const body = [
    `Игрок ${opts.playerNick} распределён в вашу фракцию «${opts.factionName}».`,
    "",
    `Дата и время: ${whenLabel} (МСК)`,
    `Обстоятельство: ${REASON_RU[opts.reason]}`,
    "",
    "— Система Распределения Игроков (СРИ)",
  ].join("\n");

  const mail = await prisma.profileMail.create({
    data: {
      title,
      body,
      senderKind: SRI_SENDER_KIND,
      senderLabel: SRI_SENDER_LABEL,
      tags: ["СРИ", "Фракции"],
      sourceKey: opts.sourceKey,
      authorId: opts.authorId,
      recipients: {
        create: ids.map((userId) => ({ userId })),
      },
    },
    select: { id: true },
  });
  return mail.id;
}

export type SriAssignResult = {
  ok: boolean;
  skipped?: string;
  userId?: string;
  nick?: string;
  faction?: string;
  factionId?: string;
  reason?: SriReason;
  mailId?: string | null;
  countsAfter?: Record<string, number>;
};

/**
 * Назначить одного свободного агента в самую малочисленную фракцию.
 */
export async function assignFreeAgent(opts: {
  userId: string;
  reason: SriReason;
}): Promise<SriAssignResult> {
  const keech = await keechUser();
  if (!keech) return { ok: false, skipped: "keech_missing" };

  const user = await prisma.user.findUnique({
    where: { id: opts.userId },
    select: {
      id: true,
      nick: true,
      name: true,
      steamName: true,
      steamId: true,
      reserveUntil: true,
      factionMembership: { select: { id: true, faction: { select: { name: true } } } },
      clanMemberships: {
        where: { clan: { tag: "BB", isExternal: false } },
        select: { role: true },
      },
    },
  });
  if (!user) return { ok: false, skipped: "user_not_found" };
  if (!user.steamId || isBuiltinSuperAdmin(user.steamId)) {
    return { ok: false, skipped: "keech_or_admin" };
  }
  if (!user.clanMemberships.length) return { ok: false, skipped: "not_in_bb" };
  if (user.clanMemberships[0].role === "RESERVE" || isActiveReserve(user.reserveUntil)) {
    return { ok: false, skipped: "in_reserve" };
  }
  if (isSlagNick(user.nick) || isSlagNick(user.steamName)) {
    return { ok: false, skipped: "slag" };
  }
  if (user.factionMembership) {
    return {
      ok: false,
      skipped: "already_in_faction",
      faction: user.factionMembership.faction.name,
    };
  }

  const factions = await listSriFactions();
  if (!factions.length) return { ok: false, skipped: "no_factions" };
  const target = pickLightest(factions.map((f) => ({ id: f.id, name: f.name, count: f.count })));
  if (!target) return { ok: false, skipped: "no_target" };

  const faction = factions.find((f) => f.id === target.id)!;
  const nick = personLabel(user);
  const when = new Date();

  await prisma.factionMember.create({
    data: {
      factionId: faction.id,
      userId: user.id,
      seat: "MEMBER",
    },
  });
  await prisma.factionInvite.updateMany({
    where: { userId: user.id, status: { in: ["PENDING", "ACCEPTED"] } },
    data: { status: "CANCELLED" },
  });

  await logFaction("join", {
    actorId: keech.id,
    actorNick: "СРИ",
    targetId: user.id,
    targetNick: nick,
    factionName: faction.name,
    clanId: faction.clanId,
    how: "СРИ",
    reason: REASON_RU[opts.reason],
  });

  await writeActionLog({
    category: "admin",
    action: "sri_assign",
    message: `СРИ распределила ${nick} в «${faction.name}» (${REASON_RU[opts.reason]})`,
    actorId: keech.id,
    actorNick: "СРИ",
    targetId: user.id,
    targetNick: nick,
    clanId: faction.clanId,
    clanTag: "BB",
    meta: {
      faction: faction.name,
      reason: opts.reason,
      ymd: formatMskYmd(when),
    },
  });

  const recipients = [...faction.leaderIds, ...faction.deputyIds, keech.id];
  let mailId: string | null = null;
  try {
    mailId = await sendSriMail({
      authorId: keech.id,
      recipientIds: recipients,
      playerNick: nick,
      factionName: faction.name,
      reason: opts.reason,
      when,
      sourceKey: `sri:assign:${user.id}:${when.toISOString()}`,
    });
  } catch (e) {
    console.error("sri mail failed", e);
  }

  const after = await listSriFactions();
  const countsAfter: Record<string, number> = {};
  for (const f of after) countsAfter[f.name] = f.count;

  return {
    ok: true,
    userId: user.id,
    nick,
    faction: faction.name,
    factionId: faction.id,
    reason: opts.reason,
    mailId,
    countsAfter,
  };
}

/** Раздать всех текущих свободных агентов по балансу. */
export async function distributeAllFreeAgents(opts?: {
  reason?: SriReason;
}): Promise<{
  before: Record<string, number>;
  assigned: SriAssignResult[];
  after: Record<string, number>;
  freeLeft: string[];
}> {
  const reason = opts?.reason || "balance_batch";
  const beforeF = await listSriFactions();
  const before: Record<string, number> = {};
  for (const f of beforeF) before[f.name] = f.count;

  const agents = await listFreeAgents();
  const assigned: SriAssignResult[] = [];
  for (const a of agents) {
    assigned.push(await assignFreeAgent({ userId: a.id, reason }));
  }

  const afterF = await listSriFactions();
  const after: Record<string, number> = {};
  for (const f of afterF) after[f.name] = f.count;
  const freeLeft = (await listFreeAgents()).map((a) => a.nick);

  return { before, assigned, after, freeLeft };
}

/** Назначить по steamId (для recruit-bot). */
export async function assignFreeAgentBySteam(
  steamId: string,
  reason: SriReason
): Promise<SriAssignResult> {
  const steam = (steamId || "").trim();
  if (!steam) return { ok: false, skipped: "no_steam" };
  const user = await prisma.user.findFirst({
    where: { steamId: steam },
    select: { id: true },
  });
  if (!user) return { ok: false, skipped: "user_not_found" };
  return assignFreeAgent({ userId: user.id, reason });
}
