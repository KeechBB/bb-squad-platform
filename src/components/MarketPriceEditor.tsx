"use client";

import { useState } from "react";

type Props = {
  catalog: "patch" | "bg" | "font";
  itemId: string;
  buy: number;
  sell: number;
  currency: "BBC" | "BD";
  onSaved: () => void;
};

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
  const [sellVal, setSellVal] = useState(String(sell));
  const [cur, setCur] = useState<"BBC" | "BD">(currency);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
          setSellVal(String(sell));
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
            Продать
            <input
              type="number"
              min={1}
              value={sellVal}
              onChange={(e) => setSellVal(e.target.value)}
            />
          </label>
          <label>
            Валюта
            <select
              value={cur}
              onChange={(e) => setCur(e.target.value as "BBC" | "BD")}
            >
              <option value="BBC">BBC</option>
              <option value="BD">B$ (казна фракции)</option>
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
  return currency === "BD" ? "B$" : "BBC";
}
