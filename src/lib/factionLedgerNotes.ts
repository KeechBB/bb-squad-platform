/**
 * Обогащение комментариев казны: ник получателя подарка / лота аукциона.
 * Пишем детально при создании; при чтении дотягиваем старые строки из sourceKey.
 */
import { prisma } from "@/lib/prisma";

export type LedgerNoteRow = {
  amount: number;
  kind: string;
  note: string | null;
  createdAt: Date;
  sourceKey?: string | null;
  userId?: string | null;
  playerNick?: string | null;
};

function nickOf(u: { nick: string | null; steamName: string | null } | null | undefined): string | null {
  if (!u) return null;
  return u.nick || u.steamName || null;
}

function appendNick(raw: string | null, nick: string | null): string | null {
  const note = String(raw || "").trim();
  const n = String(nick || "").trim();
  if (!n) return note || null;
  if (!note) return n;
  if (note.includes(n)) return note;
  // Старые шаблоны без ника → ник в конец (как у гринда, для жёлтой подсветки)
  if (/участнику\s*$/i.test(note)) {
    return note.replace(/участнику\s*$/i, `→ ${n}`);
  }
  return `${note} · ${n}`;
}

function giftToUserId(sourceKey: string): string | null {
  // member_gift:factionId:actorUserId:toUserId:amount:ts
  const parts = sourceKey.split(":");
  if (parts[0] !== "member_gift" || parts.length < 4) return null;
  return parts[3] || null;
}

function auctionLotId(sourceKey: string): string | null {
  // auction_bid:lotId:factionId:amount | auction_refund:lotId:factionId
  const m = sourceKey.match(/^auction_(?:bid|refund):([^:]+)/);
  return m?.[1] || null;
}

/** Дотянуть ники для подарков / аукциона из sourceKey (старые проводки). */
export async function enrichLedgerNotes<T extends LedgerNoteRow>(
  entries: T[],
): Promise<(T & { playerNick?: string | null; note: string | null })[]> {
  if (!entries.length) return entries;

  const giftUserIds = new Set<string>();
  const lotIds = new Set<string>();
  for (const e of entries) {
    const sk = String(e.sourceKey || "");
    if (e.kind === "member_gift") {
      const id = giftToUserId(sk);
      if (id) giftUserIds.add(id);
    }
    if (e.kind === "auction_bid" || e.kind === "auction_refund") {
      const id = auctionLotId(sk);
      if (id) lotIds.add(id);
    }
  }

  const [giftUsers, lots] = await Promise.all([
    giftUserIds.size
      ? prisma.user.findMany({
          where: { id: { in: [...giftUserIds] } },
          select: { id: true, nick: true, steamName: true },
        })
      : Promise.resolve([]),
    lotIds.size
      ? prisma.factionAuctionLot.findMany({
          where: { id: { in: [...lotIds] } },
          select: {
            id: true,
            user: { select: { nick: true, steamName: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  const nickByUser = Object.fromEntries(
    giftUsers.map((u) => [u.id, nickOf(u)]),
  );
  const nickByLot = Object.fromEntries(
    lots.map((l) => [l.id, nickOf(l.user)]),
  );

  return entries.map((e) => {
    const sk = String(e.sourceKey || "");
    let related: string | null = e.playerNick || null;
    if (e.kind === "member_gift") {
      const id = giftToUserId(sk);
      if (id) related = nickByUser[id] || related;
    } else if (e.kind === "auction_bid" || e.kind === "auction_refund") {
      const id = auctionLotId(sk);
      if (id) related = nickByLot[id] || related;
    }
    return {
      ...e,
      playerNick: related,
      note: appendNick(e.note, related),
    };
  });
}
