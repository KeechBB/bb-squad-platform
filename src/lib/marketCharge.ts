/**
 * Списание / зачисление на площадке: BBC (личный) или BD (казна фракции).
 */
import { creditBbCoins, debitBbCoins, getBbCoinBalance } from "@/lib/bbCoins";
import {
  creditFactionBd,
  debitFactionBd,
  getFactionPayCtx,
} from "@/lib/marketFactionPay";
import {
  currencyLabel,
  type MarketCurrency,
  type ResolvedListingPrice,
} from "@/lib/marketListingPrices";

export async function chargeMarketBuy(opts: {
  userId: string;
  steamId: string;
  price: ResolvedListingPrice;
  kind: string;
  noteItem: string;
}): Promise<
  | { ok: true; balance: number; currency: MarketCurrency }
  | { ok: false; error: string }
> {
  const { price } = opts;
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
    return { ok: true, balance: debited.balance, currency: "BBC" };
  }

  const ctx = await getFactionPayCtx(opts.userId, opts.steamId);
  if (!ctx) return { ok: false, error: "no_faction" };
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
  return { ok: true, balance: debited.balance, currency: "BD" };
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

  // Продажа за $: сумма всегда в казну фракции продавца (не на личный BBC).
  // Купить мог только глава/зам, продать обратно в казну — любой член фракции.
  const ctx = await getFactionPayCtx(opts.userId, opts.steamId);
  if (!ctx) {
    await opts.rollback();
    return { ok: false, error: "no_faction" };
  }
  const credited = await creditFactionBd({
    factionId: ctx.factionId,
    amount: price.sell,
    userId: opts.userId,
    note,
    sourceKey: `market_sell:${opts.kind}:${opts.userId}:${price.itemId}:${Date.now()}`,
  });
  if (!credited.ok) {
    await opts.rollback();
    return { ok: false, error: credited.error };
  }
  return { ok: true, balance: credited.balance, currency: "BD" };
}
