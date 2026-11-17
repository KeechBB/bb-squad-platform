"use client";

import { useCallback, useEffect, useState } from "react";
import type { BbCoinPackageId } from "@/lib/bbCoins";
import {
  MarketPriceEditor,
  moneyLabel,
} from "@/components/MarketPriceEditor";

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
  buyBase?: number;
  sellBase?: number;
  mine: number;
  total: number;
  owned: boolean;
  deal?: "discount" | "markup" | "sellboost" | null;
  currency?: "BBC" | "BD";
};

type BgCard = PatchCard;

type FontCard = {
  id: string;
  title: string;
  source: string;
  cssClass: string;
  sample: string;
  buy: number;
  sell: number;
  buyBase?: number;
  sellBase?: number;
  mine: number;
  total: number;
  owned: boolean;
  deal?: "discount" | "markup" | "sellboost" | null;
  currency?: "BBC" | "BD";
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
  const [factionBalance, setFactionBalance] = useState<number | null>(null);
  const [factionName, setFactionName] = useState<string | null>(null);
  const [canEditPrices, setCanEditPrices] = useState(false);
  const [packages, setPackages] = useState<Pack[]>([]);
  const [patches, setPatches] = useState<PatchCard[]>([]);
  const [bgs, setBgs] = useState<BgCard[]>([]);
  const [fonts, setFonts] = useState<FontCard[]>([]);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [topupWipOpen, setTopupWipOpen] = useState(false);

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
      setFactionBalance(
        typeof data.factionBalance === "number" ? data.factionBalance : null
      );
      setFactionName(
        typeof data.factionName === "string" ? data.factionName : null
      );
      setCanEditPrices(Boolean(data.canEditPrices));
      setPackages(data.packages || []);
      setPatches(data.patches || []);
      setBgs(data.bgs || []);
      setFonts(data.fonts || []);
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
          insufficient: "Не хватает BBC / B$ в казне",
          not_owned: "Нечего продавать — нет копий в инвентаре",
          no_faction: "Нужна фракция для оплаты B$",
          forbidden_seat: "B$ тратит только глава / зам",
        };
        setErr(map[data.error] || "Не удалось выполнить сделку");
        return;
      }
      if (data.currency === "BD") {
        if (typeof data.balance === "number") setFactionBalance(data.balance);
      } else if (typeof data.balance === "number") {
        setBalance(data.balance);
      }
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

  async function bgAction(bgId: string, action: "buy" | "sell") {
    setBusy(`${action}:bg:${bgId}`);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch("/api/bb-coins/bgs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, bgId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        const map: Record<string, string> = {
          insufficient: "Не хватает BBC / B$ в казне",
          not_owned: "Нечего продавать — нет копий в инвентаре",
          no_faction: "Нужна фракция для оплаты B$",
          forbidden_seat: "B$ тратит только глава / зам",
        };
        setErr(map[data.error] || "Не удалось выполнить сделку");
        return;
      }
      if (data.currency === "BD") {
        if (typeof data.balance === "number") setFactionBalance(data.balance);
      } else if (typeof data.balance === "number") {
        setBalance(data.balance);
      }
      setMsg(
        action === "buy"
          ? `Фон куплен (+1). У тебя: ${data.mine ?? "…"}`
          : `Фон продан (−1). У тебя: ${data.mine ?? "…"}`
      );
      await load();
    } catch {
      setErr("Сеть недоступна");
    } finally {
      setBusy(null);
    }
  }

  async function fontAction(styleId: string, action: "buy" | "sell") {
    setBusy(`${action}:font:${styleId}`);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch("/api/bb-coins/fonts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, styleId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        const map: Record<string, string> = {
          insufficient: "Не хватает BBC / B$ в казне",
          not_owned: "Нечего продавать — нет копий в инвентаре",
          no_faction: "Нужна фракция для оплаты B$",
          forbidden_seat: "B$ тратит только глава / зам",
        };
        setErr(map[data.error] || "Не удалось выполнить сделку");
        return;
      }
      if (data.currency === "BD") {
        if (typeof data.balance === "number") setFactionBalance(data.balance);
      } else if (typeof data.balance === "number") {
        setBalance(data.balance);
      }
      setMsg(
        action === "buy"
          ? `Шрифт куплен (+1). У тебя: ${data.mine ?? "…"}`
          : `Шрифт продан (−1). У тебя: ${data.mine ?? "…"}`
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
        <h1>Магазин BlackBerry</h1>
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
              {factionBalance != null ? (
                <strong className="market-balance-bd">
                  {factionBalance.toLocaleString("ru-RU")} B$
                  {factionName ? (
                    <span className="muted"> · {factionName}</span>
                  ) : null}
                </strong>
              ) : null}
            </section>
            <button
              type="button"
              className="market-topup-btn"
              onClick={() => setTopupWipOpen(true)}
            >
              Пополнить баланс
            </button>
          </div>

          {topupWipOpen ? (
            <div
              className="market-wip-modal"
              role="presentation"
              onClick={() => setTopupWipOpen(false)}
            >
              <div
                className="market-wip-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="market-wip-title"
                onClick={(e) => e.stopPropagation()}
              >
                <p id="market-wip-title" className="market-wip-title">
                  На данный момент в разработке
                </p>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setTopupWipOpen(false)}
                >
                  Понятно
                </button>
              </div>
            </div>
          ) : null}

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
              <ul className="market-patch-grid">
                {patches.map((p) => (
                  <li
                    key={p.id}
                    className={`market-patch-card${p.mine > 0 ? " is-owned" : ""}${
                      p.deal === "discount"
                        ? " has-discount"
                        : p.deal === "markup"
                          ? " has-markup"
                          : p.deal === "sellboost"
                            ? " has-sellboost"
                            : ""
                    }`}
                  >
                    {p.deal === "discount" ? (
                      <span className="market-deal-ribbon" aria-label="Скидка 20%">
                        СКИДКА −20%
                      </span>
                    ) : null}
                    {p.deal === "markup" ? (
                      <span
                        className="market-deal-ribbon market-deal-ribbon--up"
                        aria-label="Наценка 20%"
                      >
                        НАЦЕНКА +20%
                      </span>
                    ) : null}
                    {p.deal === "sellboost" ? (
                      <span
                        className="market-deal-ribbon market-deal-ribbon--sell"
                        aria-label="Продажа плюс 20%"
                      >
                        ПРОДАЖА +20%
                      </span>
                    ) : null}
                    <div className="market-patch-art">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.image} alt={p.title} />
                    </div>
                    <div className="market-patch-counts">
                      <span className="market-patch-mine" tabIndex={0}>
                        {p.mine}
                        <span className="market-patch-tip" role="tooltip">
                          У МЕНЯ
                        </span>
                      </span>
                      <span className="market-patch-total" tabIndex={0}>
                        {p.total}
                        <span className="market-patch-tip" role="tooltip">
                          всего у пользователей
                        </span>
                      </span>
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
                          {busy === `buy:${p.id}` ? (
                            "…"
                          ) : p.deal && p.buyBase && p.buyBase !== p.buy ? (
                            <>
                              <span className="market-price-old">
                                {p.buyBase}
                              </span>{" "}
                              {p.buy} {moneyLabel(p.currency)}
                            </>
                          ) : (
                            `${p.buy} ${moneyLabel(p.currency)}`
                          )}
                        </strong>
                      </button>
                      <button
                        type="button"
                        className="market-price-sell"
                        disabled={Boolean(busy) || p.mine < 1}
                        onClick={() => void patchAction(p.id, "sell")}
                      >
                        <span className="muted">продать</span>
                        <strong className={p.deal === "sellboost" ? "is-sellboost" : undefined}>
                          {busy === `sell:${p.id}`
                            ? "…"
                            : `${p.sell} ${moneyLabel(p.currency)}`}
                        </strong>
                      </button>
                    </div>
                    {canEditPrices ? (
                      <MarketPriceEditor
                        catalog="patch"
                        itemId={p.id}
                        buy={p.buyBase ?? p.buy}
                        sell={p.sellBase ?? p.sell}
                        currency={p.currency || "BBC"}
                        onSaved={() => void load()}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {tab === "bg" ? (
            <section className="market-shop" aria-label="Каталог фонов">
              <ul className="market-patch-grid market-bg-grid">
                {bgs.map((p) => (
                  <li
                    key={p.id}
                    className={`market-patch-card market-bg-card${
                      p.mine > 0 ? " is-owned" : ""
                    }${
                      p.deal === "discount"
                        ? " has-discount"
                        : p.deal === "markup"
                          ? " has-markup"
                          : p.deal === "sellboost"
                            ? " has-sellboost"
                            : ""
                    }`}
                  >
                    {p.deal === "discount" ? (
                      <span className="market-deal-ribbon" aria-label="Скидка 20%">
                        СКИДКА −20%
                      </span>
                    ) : null}
                    {p.deal === "markup" ? (
                      <span
                        className="market-deal-ribbon market-deal-ribbon--up"
                        aria-label="Наценка 20%"
                      >
                        НАЦЕНКА +20%
                      </span>
                    ) : null}
                    {p.deal === "sellboost" ? (
                      <span
                        className="market-deal-ribbon market-deal-ribbon--sell"
                        aria-label="Продажа плюс 20%"
                      >
                        ПРОДАЖА +20%
                      </span>
                    ) : null}
                    <div className="market-patch-art market-bg-art">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.image} alt={p.title} />
                    </div>
                    <div className="market-patch-counts">
                      <span className="market-patch-mine" tabIndex={0}>
                        {p.mine}
                        <span className="market-patch-tip" role="tooltip">
                          У МЕНЯ
                        </span>
                      </span>
                      <span className="market-patch-total" tabIndex={0}>
                        {p.total}
                        <span className="market-patch-tip" role="tooltip">
                          всего у пользователей
                        </span>
                      </span>
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
                        onClick={() => void bgAction(p.id, "buy")}
                      >
                        <span className="muted">купить</span>
                        <strong>
                          {busy === `buy:bg:${p.id}` ? (
                            "…"
                          ) : p.deal && p.buyBase && p.buyBase !== p.buy ? (
                            <>
                              <span className="market-price-old">
                                {p.buyBase}
                              </span>{" "}
                              {p.buy} {moneyLabel(p.currency)}
                            </>
                          ) : (
                            `${p.buy} ${moneyLabel(p.currency)}`
                          )}
                        </strong>
                      </button>
                      <button
                        type="button"
                        className="market-price-sell"
                        disabled={Boolean(busy) || p.mine < 1}
                        onClick={() => void bgAction(p.id, "sell")}
                      >
                        <span className="muted">продать</span>
                        <strong
                          className={
                            p.deal === "sellboost" ? "is-sellboost" : undefined
                          }
                        >
                          {busy === `sell:bg:${p.id}`
                            ? "…"
                            : `${p.sell} ${moneyLabel(p.currency)}`}
                        </strong>
                      </button>
                    </div>
                    {canEditPrices ? (
                      <MarketPriceEditor
                        catalog="bg"
                        itemId={p.id}
                        buy={p.buyBase ?? p.buy}
                        sell={p.sellBase ?? p.sell}
                        currency={p.currency || "BBC"}
                        onSaved={() => void load()}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {tab === "font" ? (
            <section className="market-shop" aria-label="Каталог шрифтов">
              <ul className="market-patch-grid market-font-grid">
                {fonts.map((p) => (
                  <li
                    key={p.id}
                    className={`market-patch-card market-font-card${
                      p.mine > 0 ? " is-owned" : ""
                    }${
                      p.deal === "discount"
                        ? " has-discount"
                        : p.deal === "markup"
                          ? " has-markup"
                          : p.deal === "sellboost"
                            ? " has-sellboost"
                            : ""
                    }`}
                  >
                    {p.deal === "discount" ? (
                      <span className="market-deal-ribbon" aria-label="Скидка 20%">
                        СКИДКА −20%
                      </span>
                    ) : null}
                    {p.deal === "markup" ? (
                      <span
                        className="market-deal-ribbon market-deal-ribbon--up"
                        aria-label="Наценка 20%"
                      >
                        НАЦЕНКА +20%
                      </span>
                    ) : null}
                    {p.deal === "sellboost" ? (
                      <span
                        className="market-deal-ribbon market-deal-ribbon--sell"
                        aria-label="Продажа плюс 20%"
                      >
                        ПРОДАЖА +20%
                      </span>
                    ) : null}
                    <div className="market-patch-art market-font-art">
                      <span
                        className={`public-rating-nick-label market-font-sample${
                          p.cssClass ? ` ${p.cssClass}` : ""
                        }`}
                        data-text={p.sample || "Keech"}
                      >
                        {p.sample || "Keech"}
                      </span>
                    </div>
                    <div className="market-patch-counts">
                      <span className="market-patch-mine" tabIndex={0}>
                        {p.mine}
                        <span className="market-patch-tip" role="tooltip">
                          У МЕНЯ
                        </span>
                      </span>
                      <span className="market-patch-total" tabIndex={0}>
                        {p.total}
                        <span className="market-patch-tip" role="tooltip">
                          всего у пользователей
                        </span>
                      </span>
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
                        onClick={() => void fontAction(p.id, "buy")}
                      >
                        <span className="muted">купить</span>
                        <strong>
                          {busy === `buy:font:${p.id}` ? (
                            "…"
                          ) : p.deal && p.buyBase && p.buyBase !== p.buy ? (
                            <>
                              <span className="market-price-old">
                                {p.buyBase}
                              </span>{" "}
                              {p.buy} {moneyLabel(p.currency)}
                            </>
                          ) : (
                            `${p.buy} ${moneyLabel(p.currency)}`
                          )}
                        </strong>
                      </button>
                      <button
                        type="button"
                        className="market-price-sell"
                        disabled={Boolean(busy) || p.mine < 1}
                        onClick={() => void fontAction(p.id, "sell")}
                      >
                        <span className="muted">продать</span>
                        <strong
                          className={
                            p.deal === "sellboost" ? "is-sellboost" : undefined
                          }
                        >
                          {busy === `sell:font:${p.id}`
                            ? "…"
                            : `${p.sell} ${moneyLabel(p.currency)}`}
                        </strong>
                      </button>
                    </div>
                    {canEditPrices ? (
                      <MarketPriceEditor
                        catalog="font"
                        itemId={p.id}
                        buy={p.buyBase ?? p.buy}
                        sell={p.sellBase ?? p.sell}
                        currency={p.currency || "BBC"}
                        onSaved={() => void load()}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
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
