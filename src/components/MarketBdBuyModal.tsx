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
  giftToUserId: string;
  busy: boolean;
  onGiftChange: (userId: string) => void;
  onClose: () => void;
  onConfirm: () => void;
};

export function MarketBdBuyModal({
  draft,
  canSpendBd,
  members,
  myUserId,
  giftToUserId,
  busy,
  onGiftChange,
  onClose,
  onConfirm,
}: Props) {
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
        {!canSpendBd ? (
          <>
            <p id="market-bd-buy-title" className="market-wip-title">
              {draft.title}
            </p>
            <p className="market-bd-buy-text">
              Данный предмет стоит{" "}
              <strong>
                {draft.buy.toLocaleString("ru-RU")} {moneyLabel(draft.currency)}
              </strong>
              . Купить его может только{" "}
              <strong>командир или зам фракции</strong> и подарить вам — предмет
              попадёт в ваш инвентарь.
            </p>
            <button type="button" className="btn" onClick={onClose}>
              Понятно
            </button>
          </>
        ) : (
          <>
            <p id="market-bd-buy-title" className="market-wip-title">
              Купить за казну фракции
            </p>
            <p className="market-bd-buy-text">
              <strong>{draft.title}</strong>
              <br />
              Спишется{" "}
              <strong>
                {draft.buy.toLocaleString("ru-RU")} {moneyLabel(draft.currency)}
              </strong>{" "}
              с казны. Выберите, кому уйдёт предмет:
            </p>
            <label className="market-bd-gift-label">
              Получатель
              <select
                value={giftToUserId}
                onChange={(e) => onGiftChange(e.target.value)}
              >
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.nick}
                    {m.userId === myUserId ? " (я)" : ""} · {seatLabel(m.seat)}
                  </option>
                ))}
              </select>
            </label>
            <div className="market-bd-buy-actions">
              <button
                type="button"
                className="btn"
                disabled={busy || !giftToUserId}
                onClick={onConfirm}
              >
                {busy ? "…" : "Купить и подарить"}
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
          </>
        )}
      </div>
    </div>
  );
}
