import { prisma } from "@/lib/prisma";
import { findBlackberryClanIds } from "@/lib/reserve";
import { syncCwMails } from "@/lib/cwMailSync";
import { syncTournamentEliminationMails } from "@/lib/tournamentEliminationMail";

/** Раньше корзина 30 дней — теперь удаление сразу, константа для старых вызовов. */
export const MAIL_KEEP_DELETED_MS = 0;

export const SENDER_PRESETS = {
  developer: "Разработчик",
  admin: "Администрация",
  hr: "Отдел кадров",
} as const;

export type SenderKind = keyof typeof SENDER_PRESETS | "custom";

export type MailRow = {
  id: string;
  title: string;
  body: string;
  senderKind: string;
  senderLabel: string;
  tags: string[];
  cwMatchId: string | null;
  createdAt: string;
  read: boolean;
  favorite: boolean;
  deleted: boolean;
  daysLeft: number | null;
};

export async function purgeExpiredMail() {
  // Корзины нет: всё с deletedAt и осиротевшие письма — вон.
  await prisma.profileMailRecipient.deleteMany({
    where: { deletedAt: { not: null } },
  });
  await prisma.profileMail.deleteMany({
    where: { recipients: { none: {} } },
  });
}

export async function listMailForUser(userId: string): Promise<MailRow[]> {
  await syncCwMails();
  await syncTournamentEliminationMails();
  await purgeExpiredMail();
  const rows = await prisma.profileMailRecipient.findMany({
    where: { userId, deletedAt: null },
    orderBy: { mail: { createdAt: "desc" } },
    include: {
      mail: {
        select: {
          id: true,
          title: true,
          body: true,
          senderKind: true,
          senderLabel: true,
          tags: true,
          cwMatchId: true,
          createdAt: true,
        },
      },
    },
  });
  return rows.map((row) => ({
    id: row.mail.id,
    title: row.mail.title,
    body: row.mail.body,
    senderKind: row.mail.senderKind,
    senderLabel: row.mail.senderLabel,
    tags: row.mail.tags,
    cwMatchId: row.mail.cwMatchId,
    createdAt: row.mail.createdAt.toISOString(),
    read: Boolean(row.readAt),
    favorite: Boolean(row.favoritedAt),
    deleted: false,
    daysLeft: null,
  }));
}

export async function resolveSender(kind: string, custom: string) {
  if (kind === "developer" || kind === "admin" || kind === "hr") {
    return { senderKind: kind, senderLabel: SENDER_PRESETS[kind] };
  }
  const label = custom.trim().slice(0, 40);
  if (label.length < 2) return null;
  return { senderKind: "custom", senderLabel: label };
}

export async function recipientIds(opts: {
  audience: string;
  userIds: string[];
}): Promise<string[]> {
  if (opts.audience === "clan") {
    const clanIds = await findBlackberryClanIds();
    if (!clanIds.length) return [];
    const members = await prisma.clanMember.findMany({
      where: { clanId: { in: clanIds } },
      select: { userId: true },
    });
    return [...new Set(members.map((m) => m.userId))];
  }
  if (opts.audience === "all") {
    const users = await prisma.user.findMany({ select: { id: true } });
    return users.map((u) => u.id);
  }
  const ids = [...new Set(opts.userIds.map((id) => id.trim()).filter(Boolean))];
  if (!ids.length) return [];
  const found = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  return found.map((u) => u.id);
}
