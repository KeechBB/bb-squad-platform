"use client";

import { moneyLabel } from "@/components/MarketPriceEditor";

export type FactionMarketMember = {
  userId: string;
  nick: string;
  seat: "LEADER" | "DEPUTY" | "MEMBER";
};

export type BdBuyDraft = {
  catalog: "patch" | "bg" | "font";
  itemId: string;
  title: string;
  buy: number;
  currency: "BBC" | "BD";
};

function seatLabel(seat: FactionMarketMember["seat"]): string {
  if (seat === "LEADER") return "глава";
  if (seat === "DEPUTY") return "зам";
  return "игрок";
}

type Props = {
  draft: BdBuyDraft;
  canSpendBd: boolean;
  members: FactionMarketMember[];
  myUserId: string | null;
  /** Режим: себе с личного / подарок из казны */
  payMode: "personal" | "treasury_gift";
  giftToUserId: string;
  personalBdBalance: number | null;
  busy: boolean;
  onPayModeChange: (mode: "personal" | "treasury_gift") => void;
  onGiftChange: (userId: string) => void;
  onClose: () => void;
  onConfirm: () => void;
};

export function MarketBdBuyModal({
  draft,
  canSpendBd,
  members,
  myUserId,
  payMode,
  giftToUserId,
  personalBdBalance,
  busy,
  onPayModeChange,
  onGiftChange,
  onClose,
  onConfirm,
}: Props) {
  const others = members.filter((m) => m.userId !== myUserId);
  const personalOk =
    personalBdBalance != null && personalBdBalance >= draft.buy;
  const isGift = payMode === "treasury_gift";

  return (
    <div
      className="market-wip-modal"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="market-wip-dialog market-bd-buy-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="market-bd-buy-title"
        onClick={(e) => e.stopPropagation()}
      >
        <p id="market-bd-buy-title" className="market-wip-title">
          {draft.title}
        </p>
        <p className="market-bd-buy-text">
          Цена{" "}
          <strong>
            {draft.buy.toLocaleString("ru-RU")} {moneyLabel(draft.currency)}
          </strong>
          . Покупка себе — только с <strong>личного</strong> баланса. Казна
          фракции на маркет не тратится.
        </p>
        <p className="market-bd-buy-text muted">
          У тебя лично:{" "}
          <strong>
            {personalBdBalance == null
              ? "…"
              : `${personalBdBalance.toLocaleString("ru-RU")} $`}
          </strong>
        </p>

        {canSpendBd && others.length > 0 ? (
          <div className="market-bd-pay-modes">
            <label className="market-bd-gift-label">
              <input
                type="radio"
                name="bd-pay-mode"
                checked={payMode === "personal"}
                onChange={() => onPayModeChange("personal")}
              />{" "}
              Купить себе (личный $)
            </label>
            <label className="market-bd-gift-label">
              <input
                type="radio"
                name="bd-pay-mode"
                checked={payMode === "treasury_gift"}
                onChange={() => onPayModeChange("treasury_gift")}
              />{" "}
              Подарок игроку из казны
            </label>
          </div>
        ) : null}

        {isGift ? (
          <label className="market-bd-gift-label">
            Получатель (не вы)
            <select
              value={giftToUserId}
              onChange={(e) => onGiftChange(e.target.value)}
            >
              {others.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.nick} · {seatLabel(m.seat)}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {!isGift && !personalOk ? (
          <p className="market-err">Не хватает на личном балансе</p>
        ) : null}

        <div className="market-bd-buy-actions">
          <button
            type="button"
            className="btn"
            disabled={
              busy ||
              (isGift ? !giftToUserId : !personalOk)
            }
            onClick={onConfirm}
          >
            {busy
              ? "…"
              : isGift
                ? "Купить и подарить из казны"
                : "Купить себе"}
          </button>
          <button
            type="button"
            className="btn market-bd-cancel"
            disabled={busy}
            onClick={onClose}
          >
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}
