/**
 * Доход фракции по календарным дням (МСК):
 * итог + разбивка: игроки (гринд), ставки, минусы.
 */
import { formatMskYmd } from "@/lib/squadHits";

export type FactionLedgerSlim = {
  amount: number;
  kind: string;
  note: string | null;
  createdAt: Date | string;
};

export type FactionDayItem = {
  kind: string;
  kindLabel: string;
  note: string | null;
  amount: number;
};

/** @deprecated alias */
export type FactionDayMinusItem = FactionDayItem;

export type FactionDayEconomy = {
  ymd: string;
  dateLabel: string;
  /** Нетто за день (все проводки). */
  total: number;
  /** Гринд игроков (+). */
  fromPlayers: number;
  /** Выигрыши / возвраты ставок (+). */
  fromBets: number;
  /** Прочий плюс (сделки, правки…) — сумма. */
  otherPlus: number;
  /** Расшифровка прочего плюса (не гринд / не ставки). */
  plusItems: FactionDayItem[];
  /** Сумма всех минусов (отрицательное число или 0). */
  minusTotal: number;
  minusItems: FactionDayItem[];
};

const BET_PLUS_KINDS = new Set(["night_bet_win", "night_bet_refund"]);

export function ledgerKindLabelRu(kind: string): string {
  if (kind === "grind") return "Гринд TR";
  if (kind === "transfer_in") return "Продажа игрока (приход в казну)";
  if (kind === "transfer_out") return "Покупка игрока (списание с казны)";
  if (kind === "listing_fee") return "Комиссия лота";
  if (kind === "admin_adjust") return "Ручная правка казны";
  if (kind === "contract_fee") return "Оплата контракта";
  if (kind === "salary_out") return "Выплата зарплаты";
  if (kind === "night_bet") return "Ставка на ночь";
  if (kind === "night_bet_win") return "Выигрыш ночной ставки";
  if (kind === "night_bet_refund") return "Возврат ночной ставки";
  if (kind === "auction_bid") return "Ставка на аукционе рекрута";
  if (kind === "auction_refund") return "Возврат ставки аукциона";
  if (kind === "market_buy") return "Покупка на маркете";
  if (kind === "market_sell") return "Продажа на маркете";
  if (kind === "officer_deposit") return "Взнос в казну";
  return kind;
}

function dateLabelRu(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  if (!y || !m || !d) return ymd;
  return `${d}.${m}.${y}`;
}

export function buildFactionDayEconomy(
  entries: FactionLedgerSlim[],
): FactionDayEconomy[] {
  const byDay = new Map<
    string,
    {
      total: number;
      fromPlayers: number;
      fromBets: number;
      otherPlus: number;
      plusItems: FactionDayItem[];
      minusTotal: number;
      minusItems: FactionDayItem[];
    }
  >();

  for (const e of entries) {
    const created =
      e.createdAt instanceof Date ? e.createdAt : new Date(e.createdAt);
    if (Number.isNaN(created.getTime())) continue;
    const ymd = formatMskYmd(created);
    let row = byDay.get(ymd);
    if (!row) {
      row = {
        total: 0,
        fromPlayers: 0,
        fromBets: 0,
        otherPlus: 0,
        plusItems: [],
        minusTotal: 0,
        minusItems: [],
      };
      byDay.set(ymd, row);
    }
    const amt = Math.round(Number(e.amount) || 0);
    row.total += amt;
    if (amt > 0) {
      if (e.kind === "grind") row.fromPlayers += amt;
      else if (BET_PLUS_KINDS.has(e.kind)) row.fromBets += amt;
      else {
        row.otherPlus += amt;
        row.plusItems.push({
          kind: e.kind,
          kindLabel: ledgerKindLabelRu(e.kind),
          note: e.note,
          amount: amt,
        });
      }
    } else if (amt < 0) {
      row.minusTotal += amt;
      row.minusItems.push({
        kind: e.kind,
        kindLabel: ledgerKindLabelRu(e.kind),
        note: e.note,
        amount: amt,
      });
    }
  }

  const days = [...byDay.entries()]
    .map(([ymd, row]) => ({
      ymd,
      dateLabel: dateLabelRu(ymd),
      total: row.total,
      fromPlayers: row.fromPlayers,
      fromBets: row.fromBets,
      otherPlus: row.otherPlus,
      plusItems: row.plusItems.sort((a, b) => b.amount - a.amount),
      minusTotal: row.minusTotal,
      minusItems: row.minusItems.sort((a, b) => a.amount - b.amount),
    }))
    .sort((a, b) => b.ymd.localeCompare(a.ymd));

  return days;
}
