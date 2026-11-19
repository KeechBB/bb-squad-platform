"use client";

import { useState } from "react";
import type { FactionMarketMember } from "@/components/MarketBdBuyModal";

function seatLabel(seat: FactionMarketMember["seat"]): string {
  if (seat === "LEADER") return "глава";
  if (seat === "DEPUTY") return "зам";
  return "игрок";
}

type Props = {
  members: FactionMarketMember[];
  myUserId: string | null;
  factionName: string | null;
  factionBalance: number | null;
  infiniteWallet: boolean;
  busy: boolean;
  onClose: () => void;
  onGift: (opts: {
    toUserId: string;
    amount: number;
  }) => Promise<void>;
};

export function MarketBdGiftModal({
  members,
  myUserId,
  factionName,
  factionBalance,
  infiniteWallet,
  busy,
  onClose,
  onGift,
}: Props) {
  const recipients = members.filter((m) => m.userId !== myUserId);
  const [toUserId, setToUserId] = useState(recipients[0]?.userId || "");
  const [amountStr, setAmountStr] = useState("1000");
  const [localErr, setLocalErr] = useState<string | null>(null);

  async function submit() {
    setLocalErr(null);
    const amount = Math.trunc(Number(String(amountStr).replace(/\s/g, "")) || 0);
    if (!toUserId) {
      setLocalErr("Выбери получателя");
      return;
    }
    if (amount < 1) {
      setLocalErr("Сумма должна быть больше 0");
      return;
    }
    if (
      !infiniteWallet &&
      typeof factionBalance === "number" &&
      amount > factionBalance
    ) {
      setLocalErr("Не хватает в казне фракции");
      return;
    }
    await onGift({ toUserId, amount });
  }

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
        aria-labelledby="market-bd-gift-title"
        onClick={(e) => e.stopPropagation()}
      >
        <p id="market-bd-gift-title" className="market-wip-title">
          Подарить Черничные доллары
        </p>
        <p className="market-bd-buy-text">
          Списание с казны
          {factionName ? (
            <>
              {" "}
              <strong>{factionName}</strong>
            </>
          ) : null}
          {" → "}
          личный баланс участника.
          <br />
          В казне:{" "}
          <strong>
            {infiniteWallet
              ? "∞ $"
              : factionBalance == null
                ? "—"
                : `${factionBalance.toLocaleString("ru-RU")} $`}
          </strong>
        </p>

        {recipients.length === 0 ? (
          <p className="market-bd-buy-text">В фракции пока некого дарить.</p>
        ) : (
          <>
            <label className="market-bd-gift-label">
              Получатель
              <select
                value={toUserId}
                onChange={(e) => setToUserId(e.target.value)}
                disabled={busy}
              >
                {recipients.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.nick} · {seatLabel(m.seat)}
                  </option>
                ))}
              </select>
            </label>
            <label className="market-bd-gift-label">
              Сумма ($)
              <input
                type="number"
                min={1}
                step={1}
                value={amountStr}
                disabled={busy}
                onChange={(e) => setAmountStr(e.target.value)}
              />
            </label>
          </>
        )}

        {localErr ? <p className="market-err">{localErr}</p> : null}

        <div className="market-bd-buy-actions">
          <button
            type="button"
            className="btn"
            disabled={busy || recipients.length === 0}
            onClick={() => void submit()}
          >
            {busy ? "…" : "Подарить"}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}
