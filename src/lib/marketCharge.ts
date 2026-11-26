/**
 * Списание / зачисление на площадке: BBC (личный) или BD.
 * B$ на маркете: покупка себе и продажа — личный баланс.
 * Казна — лишь когда глава/зам явно дарит предмет другому игроку.
 */
import { isBuiltinSuperAdmin } from "@/lib/admin";
import { creditBbCoins, debitBbCoins, getBbCoinBalance } from "@/lib/bbCoins";
import {
  creditPersonalBd,
  debitFactionBd,
  debitPersonalBd,
  getFactionPayCtx,
  getPersonalBdBalance,
} from "@/lib/marketFactionPay";
import {
  currencyLabel,
  type MarketCurrency,
  type ResolvedListingPrice,
} from "@/lib/marketListingPrices";

/** Капитан: бесконечный кошелёк на площадке (кейсы / покупки). */
export const INFINITE_MARKET_BALANCE = 9_999_999;

export function hasInfiniteMarketWallet(
  steamId: string | null | undefined
): boolean {
  return isBuiltinSuperAdmin(steamId);
}

export async function chargeMarketBuy(opts: {
  userId: string;
  steamId: string;
  price: ResolvedListingPrice;
  kind: string;
  noteItem: string;
  /**
   * Списать B$ с казны (только подарок другому).
   * По умолчанию / себе — всегда личный B$.
   */
  spendTreasury?: boolean;
}): Promise<
  | {
      ok: true;
      balance: number;
      currency: MarketCurrency;
      /** Откуда списали BD: казна или личный кошелёк. */
      paidFrom?: "treasury" | "personal" | "bbc" | "infinite";
    }
  | { ok: false; error: string }
> {
  const { price } = opts;

  if (hasInfiniteMarketWallet(opts.steamId)) {
    return {
      ok: true,
      balance: INFINITE_MARKET_BALANCE,
      currency: price.currency,
      paidFrom: "infinite",
    };
  }

  const cur = currencyLabel(price.currency);
  const dealNote =
    price.deal === "discount"
      ? " · скидка −20%"
      : price.deal === "markup"
        ? " · наценка +20%"
        : "";
  const note = `Покупка ${opts.noteItem} (−${price.buy} ${cur})${dealNote}`;

  if (price.currency === "BBC") {
    const bal = await getBbCoinBalance(opts.userId);
    if (bal < price.buy) return { ok: false, error: "insufficient" };
    const debited = await debitBbCoins({
      userId: opts.userId,
      amount: price.buy,
      kind: opts.kind,
      ref: null,
      note,
    });
    if (!debited.ok) {
      return {
        ok: false,
        error: debited.error === "insufficient" ? "insufficient" : "debit",
      };
    }
    return {
      ok: true,
      balance: debited.balance,
      currency: "BBC",
      paidFrom: "bbc",
    };
  }

  const ctx = await getFactionPayCtx(opts.userId, opts.steamId);
  if (!ctx) return { ok: false, error: "no_faction" };

  if (opts.spendTreasury) {
    if (!ctx.canSpend) return { ok: false, error: "forbidden_seat" };
    if (ctx.balance < price.buy) return { ok: false, error: "insufficient" };
    const debited = await debitFactionBd({
      factionId: ctx.factionId,
      amount: price.buy,
      userId: opts.userId,
      note,
      sourceKey: `market_buy:${opts.kind}:${opts.userId}:${price.itemId}:${Date.now()}`,
    });
    if (!debited.ok) return { ok: false, error: debited.error };
    return {
      ok: true,
      balance: debited.balance,
      currency: "BD",
      paidFrom: "treasury",
    };
  }

  const personal = await getPersonalBdBalance(opts.userId);
  if (personal < price.buy) return { ok: false, error: "insufficient_personal" };
  const debited = await debitPersonalBd({
    userId: opts.userId,
    amount: price.buy,
  });
  if (!debited.ok) return { ok: false, error: debited.error };
  return {
    ok: true,
    balance: debited.balance,
    currency: "BD",
    paidFrom: "personal",
  };
}

export async function creditMarketSell(opts: {
  userId: string;
  steamId: string;
  price: ResolvedListingPrice;
  kind: string;
  noteItem: string;
  /** Вернуть предмет, если кредит не прошёл */
  rollback: () => Promise<void>;
}): Promise<
  | { ok: true; balance: number; currency: MarketCurrency }
  | { ok: false; error: string }
> {
  const { price } = opts;
  const cur = currencyLabel(price.currency);
  const dealNote =
    price.deal === "sellboost"
      ? " · продажа +20%"
      : price.deal === "discount"
        ? " · скидка −20%"
        : price.deal === "markup"
          ? " · наценка +20%"
          : "";
  const note = `Продажа ${opts.noteItem} (+${price.sell} ${cur})${dealNote}`;

  if (price.currency === "BBC") {
    const credited = await creditBbCoins({
      userId: opts.userId,
      amount: price.sell,
      kind: opts.kind,
      ref: `${price.itemId}:${Date.now()}`,
      note,
    });
    if (!credited.ok) {
      await opts.rollback();
      return { ok: false, error: "credit" };
    }
    return { ok: true, balance: credited.balance, currency: "BBC" };
  }

  // Продажа за $: на личный баланс (покупка себе тоже с личного; казна — только подарок).
  const ctx = await getFactionPayCtx(opts.userId, opts.steamId);
  if (!ctx) {
    await opts.rollback();
    return { ok: false, error: "no_faction" };
  }
  const credited = await creditPersonalBd({
    userId: opts.userId,
    amount: price.sell,
  });
  if (!credited.ok) {
    await opts.rollback();
    return { ok: false, error: credited.error };
  }
  return { ok: true, balance: credited.balance, currency: "BD" };
}
