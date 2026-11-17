"use client";

import { useState } from "react";
import { PATCH_SELL_OF_BUY } from "@/lib/bbCoinPatchPrices";

type Props = {
  catalog: "patch" | "bg" | "font";
  itemId: string;
  buy: number;
  sell: number;
  currency: "BBC" | "BD";
  onSaved: () => void;
};

function sellFromBuy(buyRaw: string): string {
  const n = Math.trunc(Number(buyRaw));
  if (!Number.isFinite(n) || n < 1) return "";
  return String(Math.max(1, Math.round(n * PATCH_SELL_OF_BUY)));
}

export function MarketPriceEditor({
  catalog,
  itemId,
  buy,
  sell,
  currency,
  onSaved,
}: Props) {
  const [open, setOpen] = useState(false);
  const [buyVal, setBuyVal] = useState(String(buy));
  const [cur, setCur] = useState<"BBC" | "BD">(currency);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const sellVal = sellFromBuy(buyVal) || String(sell);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/bb-coins/listing-prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          catalog,
          itemId,
          currency: cur,
          buyPrice: Number(buyVal),
          sellPrice: Number(sellVal),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        const map: Record<string, string> = {
          buy: "Цена покупки",
          sell: "Цена продажи",
          sell_gt_buy: "Продажа не выше покупки",
          forbidden: "Нет прав",
          item: "Нет такого предмета",
        };
        setErr(map[data.error] || data.error || "Ошибка");
        return;
      }
      setOpen(false);
      onSaved();
    } catch {
      setErr("Сеть");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="market-price-editor">
      <button
        type="button"
        className="market-price-edit-btn"
        onClick={() => {
          setBuyVal(String(buy));
          setCur(currency);
          setOpen((v) => !v);
        }}
      >
        {open ? "Скрыть цены" : "Править цены"}
      </button>
      {open ? (
        <div className="market-price-edit-panel">
          <label>
            Купить
            <input
              type="number"
              min={1}
              value={buyVal}
              onChange={(e) => setBuyVal(e.target.value)}
            />
          </label>
          <label>
            Продать · авто 80%
            <input type="number" min={1} value={sellVal} readOnly disabled />
          </label>
          <label>
            Валюта
            <select
              value={cur}
              onChange={(e) => setCur(e.target.value as "BBC" | "BD")}
            >
              <option value="BBC">BBC</option>
              <option value="BD">$ (казна фракции)</option>
            </select>
          </label>
          <button type="button" disabled={busy} onClick={() => void save()}>
            {busy ? "…" : "Сохранить"}
          </button>
          {err ? <span className="market-price-edit-err">{err}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

export function moneyLabel(currency: "BBC" | "BD" | undefined): string {
  return currency === "BD" ? "$" : "BBC";
}
