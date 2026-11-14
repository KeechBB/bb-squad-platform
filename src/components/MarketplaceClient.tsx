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

type PatchCard = {
  id: string;
  title: string;
  source: string;
  image: string;
  buy: number;
  sell: number;
  mine: number;
  total: number;
  owned: boolean;
};

type Tx = {
  id: string;
  delta: number;
  balanceAfter: number;
  kind: string;
  note: string | null;
  at: string;
};

/** Основные вкладки площадки + topup только с кнопки «Пополнить». */
type Tab = "patches" | "bg" | "font" | "topup";

type Props = {
  loggedIn: boolean;
};

const MAIN_TABS: { id: Exclude<Tab, "topup">; label: string }[] = [
  { id: "patches", label: "Нашивки" },
  { id: "bg", label: "Фон" },
  { id: "font", label: "Шрифт" },
];

export function MarketplaceClient({ loggedIn }: Props) {
  const [tab, setTab] = useState<Tab>("patches");
  const [balance, setBalance] = useState<number | null>(null);
  const [packages, setPackages] = useState<Pack[]>([]);
  const [patches, setPatches] = useState<PatchCard[]>([]);
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
            : "Не удалось загрузить площадку"
        );
        return;
      }
      setBalance(data.balance);
      setPackages(data.packages || []);
      setPatches(data.patches || []);
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

  async function orderPack(packageId: string) {
    setBusy(`pack:${packageId}`);
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

  async function patchAction(patchId: string, action: "buy" | "sell") {
    setBusy(`${action}:${patchId}`);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch("/api/bb-coins/patches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, patchId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        const map: Record<string, string> = {
          insufficient: "Не хватает BB Coins — пополни баланс",
          not_owned: "Нечего продавать — нет копий в инвентаре",
        };
        setErr(map[data.error] || "Не удалось выполнить сделку");
        return;
      }
      if (typeof data.balance === "number") setBalance(data.balance);
      setMsg(
        action === "buy"
          ? `Куплено (+1). У тебя: ${data.mine ?? "…"}`
          : `Продано (−1). У тебя: ${data.mine ?? "…"}`
      );
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
        <h1>Магазин кастома</h1>
        <p className="market-lead">
          Нашивки, фоны и шрифты за BB Coins. Продать = <strong>80%</strong> от
          покупки. Курс пополнения: <strong>2 BBC = 1 ₽</strong>.
        </p>
      </header>

      {!loggedIn ? (
        <p className="market-note">Войди через Steam, чтобы торговать.</p>
      ) : (
        <>
          <div className="market-topbar">
            <section className="market-balance" aria-live="polite">
              <span className="muted">Твой баланс</span>
              <strong>
                {balance == null ? "…" : balance.toLocaleString("ru-RU")} BBC
              </strong>
            </section>
            <button
              type="button"
              className={`market-topup-btn${tab === "topup" ? " is-active" : ""}`}
              onClick={() => setTab("topup")}
            >
              Пополнить баланс
            </button>
          </div>

          <nav className="market-tabs" aria-label="Разделы площадки">
            {MAIN_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={tab === t.id ? "is-active" : undefined}
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>

          {msg ? <p className="market-ok">{msg}</p> : null}
          {err ? <p className="market-err">{err}</p> : null}

          {tab === "patches" ? (
            <section className="market-shop" aria-label="Каталог нашивок">
              <p className="muted market-packs-note">
                Слева жёлтым — сколько у тебя копий. Справа — всего на площадке.
                Можно купить несколько одной и той же; ивент дня тоже даёт +1 за
                круг.
              </p>
              <ul className="market-patch-grid">
                {patches.map((p) => (
                  <li
                    key={p.id}
                    className={`market-patch-card${p.mine > 0 ? " is-owned" : ""}`}
                  >
                    <span
                      className="market-patch-mine"
                      title="Твои копии"
                    >
                      {p.mine}
                    </span>
                    <span
                      className="market-patch-total"
                      title="Всего копий у игроков"
                    >
                      {p.total}
                    </span>
                    <div className="market-patch-art">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.image} alt={p.title} />
                    </div>
                    <div className="market-patch-meta">
                      <strong>{p.title}</strong>
                      <span className="muted">{p.source}</span>
                      {p.mine > 0 ? (
                        <span className="market-owned-tag">
                          у тебя ×{p.mine}
                        </span>
                      ) : null}
                    </div>
                    <div className="market-patch-prices">
                      <button
                        type="button"
                        className="market-price-buy"
                        disabled={Boolean(busy)}
                        onClick={() => void patchAction(p.id, "buy")}
                      >
                        <span className="muted">купить</span>
                        <strong>
                          {busy === `buy:${p.id}` ? "…" : `${p.buy} BBC`}
                        </strong>
                      </button>
                      <button
                        type="button"
                        className="market-price-sell"
                        disabled={Boolean(busy) || p.mine < 1}
                        onClick={() => void patchAction(p.id, "sell")}
                      >
                        <span className="muted">продать</span>
                        <strong>
                          {busy === `sell:${p.id}` ? "…" : `${p.sell} BBC`}
                        </strong>
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {tab === "bg" ? (
            <section className="market-soon" aria-label="Фоны профиля">
              <h2>Фон</h2>
              <p className="muted">
                Каталог фонов профиля появится здесь — те же карточки купить /
                продать, что у нашивок.
              </p>
            </section>
          ) : null}

          {tab === "font" ? (
            <section className="market-soon" aria-label="Шрифты ника">
              <h2>Шрифт</h2>
              <p className="muted">
                Каталог шрифтов ника появится здесь — те же карточки купить /
                продать.
              </p>
            </section>
          ) : null}

          {tab === "topup" ? (
            <>
              <section className="market-packs" aria-label="Пакеты BB Coins">
                <h2>Пополнить за рубли</h2>
                <p className="muted market-packs-note">
                  Эквайринг (ЮKassa / чеки) подключим отдельно. Сейчас заказ
                  создаётся в статусе «ожидает оплаты». Курс: 2 BBC = 1 ₽.
                </p>
                <ul className="market-pack-list">
                  {packages.map((p) => (
                    <li key={p.id} className="market-pack">
                      <div>
                        <strong>{p.label}</strong>
                        {p.badge ? (
                          <span className="market-badge">{p.badge}</span>
                        ) : null}
                        <p className="muted">{p.rubles} ₽</p>
                      </div>
                      <div className="market-pack-actions">
                        <button
                          type="button"
                          className="btn"
                          disabled={Boolean(busy)}
                          onClick={() => void orderPack(p.id)}
                        >
                          {busy === `pack:${p.id}` ? "…" : "Заказать"}
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
                        <span
                          className={
                            t.delta >= 0 ? "market-plus" : "market-minus"
                          }
                        >
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
          ) : null}
        </>
      )}
    </div>
  );
}
