/**
 * Балансы фракций (казна) и игроков (личный B$) + дневная расшифровка.
 */
import { prisma } from "@/lib/prisma";
import { RACE_FACTION_NAMES, isRaceExcludedName } from "@/lib/factionRaceCanon";
import { factionLogoColor } from "@/lib/factionBoard";
import { factionCanonColor } from "@/lib/factionColors";
import {
  buildFactionDayEconomy,
  ledgerKindLabelRu,
  type FactionDayEconomy,
  type FactionDayItem,
} from "@/lib/factionDayEconomy";
import { enrichLedgerNotes } from "@/lib/factionLedgerNotes";
import { CONTRACT_PLAYER_CUT_RATIO } from "@/lib/factionHr";
import { formatMskYmd } from "@/lib/squadHits";

/** С этой даты (МСК) показываем дневную историю. */
export const BALANCES_DAY_MIN_YMD = "2026-11-24";

export type BalanceFactionRow = {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  color: string;
  balance: number;
  members: number;
};

export type BalancePlayerRow = {
  userId: string;
  nick: string;
  steamId: string | null;
  balance: number;
  seat: string;
  factionId: string;
  factionName: string;
  factionSlug: string;
  factionLogoUrl: string | null;
  factionColor: string;
};

export type PersonalDayItem = {
  kind: string;
  kindLabel: string;
  note: string | null;
  amount: number;
};

export type PersonalDayEconomy = {
  ymd: string;
  dateLabel: string;
  total: number;
  items: PersonalDayItem[];
};

function dateLabelRu(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  if (!y || !m || !d) return ymd;
  return `${d}.${m}.${y}`;
}

function filterDaysFromMin<T extends { ymd: string }>(days: T[]): T[] {
  return days.filter((d) => d.ymd >= BALANCES_DAY_MIN_YMD);
}

async function bbClanId(): Promise<string | null> {
  const bb = await prisma.clan.findFirst({
    where: { tag: "BB", isExternal: false },
    select: { id: true },
  });
  return bb?.id || null;
}

export async function listBalanceFactions(): Promise<BalanceFactionRow[]> {
  const clanId = await bbClanId();
  if (!clanId) return [];
  const factions = await prisma.faction.findMany({
    where: { clanId, name: { in: [...RACE_FACTION_NAMES] } },
    select: {
      id: true,
      name: true,
      slug: true,
      logoUrl: true,
      blueberryBalance: true,
      info: true,
      _count: { select: { members: true } },
    },
    orderBy: { name: "asc" },
  });
  const rows = factions.filter((f) => !isRaceExcludedName(f.name, f.slug));
  const out: BalanceFactionRow[] = [];
  for (const f of rows) {
    const color =
      factionCanonColor(f.name, f.slug) ||
      (await factionLogoColor(f.id, f.name, f.slug));
    out.push({
      id: f.id,
      name: f.name,
      slug: f.slug,
      logoUrl: f.logoUrl,
      color,
      balance: Math.max(0, f.blueberryBalance || 0),
      members: f._count.members,
    });
  }
  out.sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name, "ru"));
  return out;
}

export async function listBalancePlayers(): Promise<BalancePlayerRow[]> {
  const factions = await listBalanceFactions();
  if (!factions.length) return [];
  const byId = Object.fromEntries(factions.map((f) => [f.id, f]));
  const members = await prisma.factionMember.findMany({
    where: { factionId: { in: factions.map((f) => f.id) } },
    select: {
      seat: true,
      factionId: true,
      user: {
        select: {
          id: true,
          nick: true,
          steamName: true,
          steamId: true,
          blueberryBalance: true,
        },
      },
    },
  });
  const out: BalancePlayerRow[] = members.map((m) => {
    const f = byId[m.factionId]!;
    return {
      userId: m.user.id,
      nick: m.user.nick || m.user.steamName || "игрок",
      steamId: m.user.steamId,
      balance: Math.max(0, m.user.blueberryBalance || 0),
      seat: m.seat,
      factionId: f.id,
      factionName: f.name,
      factionSlug: f.slug,
      factionLogoUrl: f.logoUrl,
      factionColor: f.color,
    };
  });
  out.sort(
    (a, b) =>
      b.balance - a.balance ||
      a.nick.localeCompare(b.nick, "ru", { sensitivity: "base" }),
  );
  return out;
}

async function enrichTransferNicks(
  entries: {
    amount: number;
    kind: string;
    note: string | null;
    createdAt: Date;
    sourceKey: string;
  }[],
): Promise<
  {
    amount: number;
    kind: string;
    note: string | null;
    createdAt: Date;
    playerNick?: string | null;
  }[]
> {
  const offerIds = [
    ...new Set(
      entries
        .map((e) => {
          const m = String(e.sourceKey || "").match(/^xfer_(?:in|out):(.+)$/);
          return m?.[1] || null;
        })
        .filter(Boolean) as string[],
    ),
  ];
  if (!offerIds.length) {
    return entries.map((e) => ({
      amount: e.amount,
      kind: e.kind,
      note: e.note,
      createdAt: e.createdAt,
    }));
  }
  const offers = await prisma.transferOffer.findMany({
    where: { id: { in: offerIds } },
    select: { id: true, listing: { select: { playerUserId: true } } },
  });
  const playerIds = [...new Set(offers.map((o) => o.listing.playerUserId))];
  const users = await prisma.user.findMany({
    where: { id: { in: playerIds } },
    select: { id: true, nick: true, steamName: true },
  });
  const nickByUser = Object.fromEntries(
    users.map((u) => [u.id, u.nick || u.steamName || "игрок"]),
  );
  const nickByOffer = Object.fromEntries(
    offers.map((o) => [o.id, nickByUser[o.listing.playerUserId] || null]),
  );
  const withXfer = entries.map((e) => {
    const m = String(e.sourceKey || "").match(/^xfer_(?:in|out):(.+)$/);
    return {
      amount: e.amount,
      kind: e.kind,
      note: e.note,
      createdAt: e.createdAt,
      sourceKey: e.sourceKey,
      playerNick: m?.[1] ? nickByOffer[m[1]] || null : null,
    };
  });
  return enrichLedgerNotes(withXfer);
}

export async function factionBalanceDays(
  factionId: string,
): Promise<FactionDayEconomy[]> {
  const entries = await prisma.factionLedgerEntry.findMany({
    where: { factionId },
    select: {
      amount: true,
      kind: true,
      note: true,
      createdAt: true,
      sourceKey: true,
    },
    orderBy: { createdAt: "desc" },
  });
  const enriched = await enrichTransferNicks(entries);
  return filterDaysFromMin(buildFactionDayEconomy(enriched));
}

function personalKindLabel(kind: string): string {
  if (kind === "salary_in") return "Зарплата";
  if (kind === "contract_cut") return "Доля с контракта (20%)";
  if (kind === "officer_deposit_out") return "Взнос в казну фракции";
  if (kind === "auction_recruit_cut") return "Доля с аукциона рекрута (10%)";
  return ledgerKindLabelRu(kind);
}

export async function playerPersonalDays(
  userId: string,
): Promise<PersonalDayEconomy[]> {
  const [ledger, lots] = await Promise.all([
    prisma.factionLedgerEntry.findMany({
      where: {
        userId,
        kind: { in: ["salary_out", "contract_fee", "officer_deposit"] },
      },
      select: {
        amount: true,
        kind: true,
        note: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 2000,
    }),
    prisma.factionAuctionLot.findMany({
      where: {
        userId,
        status: "SETTLED",
        recruitCutBd: { gt: 0 },
      },
      select: {
        recruitCutBd: true,
        endsAt: true,
        updatedAt: true,
        note: true,
      },
      take: 200,
    }),
  ]);

  const items: { createdAt: Date; kind: string; note: string | null; amount: number }[] =
    [];

  for (const e of ledger) {
    if (e.kind === "salary_out" && e.amount < 0) {
      items.push({
        createdAt: e.createdAt,
        kind: "salary_in",
        note: e.note,
        amount: Math.abs(e.amount),
      });
    } else if (e.kind === "contract_fee" && e.amount < 0) {
      const cut = Math.max(
        0,
        Math.floor(Math.abs(e.amount) * CONTRACT_PLAYER_CUT_RATIO),
      );
      if (cut > 0) {
        items.push({
          createdAt: e.createdAt,
          kind: "contract_cut",
          note: e.note,
          amount: cut,
        });
      }
    } else if (e.kind === "officer_deposit" && e.amount > 0) {
      items.push({
        createdAt: e.createdAt,
        kind: "officer_deposit_out",
        note: e.note,
        amount: -e.amount,
      });
    }
  }

  for (const lot of lots) {
    const cut = Math.max(0, Math.round(lot.recruitCutBd || 0));
    if (!cut) continue;
    items.push({
      createdAt: lot.endsAt || lot.updatedAt,
      kind: "auction_recruit_cut",
      note: lot.note || "10% победной ставки аукциона",
      amount: cut,
    });
  }

  const byDay = new Map<string, PersonalDayItem[]>();
  for (const it of items) {
    const ymd = formatMskYmd(it.createdAt);
    if (ymd < BALANCES_DAY_MIN_YMD) continue;
    const row = byDay.get(ymd) || [];
    row.push({
      kind: it.kind,
      kindLabel: personalKindLabel(it.kind),
      note: it.note,
      amount: it.amount,
    });
    byDay.set(ymd, row);
  }

  return [...byDay.entries()]
    .map(([ymd, dayItems]) => {
      const sorted = dayItems.sort((a, b) => b.amount - a.amount);
      const total = sorted.reduce((s, x) => s + x.amount, 0);
      return {
        ymd,
        dateLabel: dateLabelRu(ymd),
        total,
        items: sorted,
      };
    })
    .sort((a, b) => b.ymd.localeCompare(a.ymd));
}

export type { FactionDayEconomy, FactionDayItem };
