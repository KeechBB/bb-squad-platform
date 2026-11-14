"use client";

import { useCallback, useEffect, useState } from "react";
import type { BbCoinPackageId } from "@/lib/bbCoins";

type Pack = {
  id: BbCoinPackageId | string;
  rubles: number;
  coins: number;
  label: string;
  badge?: string;
};

type Tx = {
  id: string;
  delta: number;
  balanceAfter: number;
  kind: string;
  note: string | null;
  at: string;
};

type Props = {
  loggedIn: boolean;
};

export function MarketplaceClient({ loggedIn }: Props) {
  const [balance, setBalance] = useState<number | null>(null);
  const [packages, setPackages] = useState<Pack[]>([]);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!loggedIn) return;
    setErr(null);
    try {
      const res = await fetch("/api/bb-coins", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErr(
          data.error === "profile"
            ? "Сначала заполни анкету профиля"
            : "Не удалось загрузить баланс"
        );
        return;
      }
      setBalance(data.balance);
      setPackages(data.packages || []);
      setTxs(data.txs || []);
      if (data.grantedNow > 0) {
        setMsg(`Зачислено ${data.grantedNow} BB Coins за прогнозы турнира.`);
      }
    } catch {
      setErr("Сеть недоступна");
    }
  }, [loggedIn]);

  useEffect(() => {
    void load();
  }, [load]);

  async function buy(packageId: string) {
    setBusy(packageId);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch("/api/bb-coins/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packageId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErr("Не удалось создать заказ");
        return;
      }
      setMsg(data.message || "Заказ создан");
      await load();
    } catch {
      setErr("Сеть недоступна");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="market-page">
      <header className="market-head">
        <p className="market-kicker">Торговая площадка</p>
        <h1>BB Coins</h1>
        <p className="market-lead">
          Внутренняя валюта платформы. Курс покупки:{" "}
          <strong>2 BB Coins = 1 ₽</strong>. Раньше это были BB Points за
          прогнозы турнира — теперь единый баланс. Вывода в рубли нет.
        </p>
      </header>

      {!loggedIn ? (
        <p className="market-note">Войди через Steam, чтобы видеть баланс и покупать.</p>
      ) : (
        <>
          <section className="market-balance" aria-live="polite">
            <span className="muted">Твой баланс</span>
            <strong>
              {balance == null ? "…" : balance.toLocaleString("ru-RU")} BB Coins
            </strong>
          </section>

          {msg ? <p className="market-ok">{msg}</p> : null}
          {err ? <p className="market-err">{err}</p> : null}

          <section className="market-packs" aria-label="Пакеты BB Coins">
            <h2>Купить за рубли</h2>
            <p className="muted market-packs-note">
              Эквайринг (ЮKassa / чеки) подключим отдельно. Сейчас заказ
              создаётся в статусе «ожидает оплаты».
            </p>
            <ul className="market-pack-list">
              {packages.map((p) => (
                <li key={p.id} className="market-pack">
                  <div>
                    <strong>{p.label}</strong>
                    {p.badge ? <span className="market-badge">{p.badge}</span> : null}
                    <p className="muted">{p.rubles} ₽</p>
                  </div>
                  <div className="market-pack-actions">
                    <button
                      type="button"
                      className="btn"
                      disabled={Boolean(busy)}
                      onClick={() => void buy(p.id)}
                    >
                      {busy === p.id ? "…" : "Заказать"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="market-txs" aria-label="История BB Coins">
            <h2>История</h2>
            {txs.length === 0 ? (
              <p className="muted">Пока пусто.</p>
            ) : (
              <ul className="market-tx-list">
                {txs.map((t) => (
                  <li key={t.id}>
                    <span className={t.delta >= 0 ? "market-plus" : "market-minus"}>
                      {t.delta >= 0 ? "+" : ""}
                      {t.delta}
                    </span>
                    <span>{t.note || t.kind}</span>
                    <span className="muted">
                      {new Date(t.at).toLocaleString("ru-RU", {
                        timeZone: "Europe/Moscow",
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
