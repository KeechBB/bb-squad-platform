"use client";

import { useCallback, useEffect, useState } from "react";
import type { BbCoinPackageId } from "@/lib/bbCoins";
import {
  MarketPriceEditor,
  moneyLabel,
} from "@/components/MarketPriceEditor";
import {
  MarketBdBuyModal,
  type BdBuyDraft,
  type FactionMarketMember,
} from "@/components/MarketBdBuyModal";
import { MarketBdGiftModal } from "@/components/MarketBdGiftModal";
import { MarketCasesPanel } from "@/components/MarketCasesPanel";

/** Основные вкладки площадки + topup только с кнопки «Пополнить». */
type Tab = "patches" | "bg" | "font" | "cases" | "topup";
type MainTab = Exclude<Tab, "topup">;

const MARKET_TAB_KEY = "bb-market-tab";

function readStoredMarketTab(): MainTab {
  if (typeof window === "undefined") return "patches";
  try {
    const v = window.localStorage.getItem(MARKET_TAB_KEY);
    if (v === "patches" || v === "bg" || v === "font" || v === "cases") return v;
  } catch {
    /* ignore */
  }
  return "patches";
}

function writeStoredMarketTab(id: MainTab) {
  try {
    window.localStorage.setItem(MARKET_TAB_KEY, id);
  } catch {
    /* ignore */
  }
}

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
  /** Кейсовые легендарки: только продажа. */
  buyDisabled?: boolean;
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

type Props = {
  loggedIn: boolean;
};

const MAIN_TABS: { id: MainTab; label: string }[] = [
  { id: "patches", label: "Нашивки" },
  { id: "bg", label: "Фон" },
  { id: "font", label: "Шрифт" },
  { id: "cases", label: "Кейсы" },
];

export function MarketplaceClient({ loggedIn }: Props) {
  const [tab, setTab] = useState<Tab>("patches");
  const [balance, setBalance] = useState<number | null>(null);
  const [infiniteWallet, setInfiniteWallet] = useState(false);
  const [factionBalance, setFactionBalance] = useState<number | null>(null);
  const [personalBdBalance, setPersonalBdBalance] = useState<number | null>(
    null
  );
  const [factionName, setFactionName] = useState<string | null>(null);
  const [canSpendBd, setCanSpendBd] = useState(false);
  const [bdGiftOpen, setBdGiftOpen] = useState(false);
  const [factionMembers, setFactionMembers] = useState<FactionMarketMember[]>(
    []
  );
  const [myUserId, setMyUserId] = useState<string | null>(null);
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
  const [casesWipOpen, setCasesWipOpen] = useState(false);
  const [bdBuyDraft, setBdBuyDraft] = useState<BdBuyDraft | null>(null);
  const [giftToUserId, setGiftToUserId] = useState("");
  /** Кейсы пока только капитану (canEditPrices = super-admin). */
  const casesUnlocked = canEditPrices;

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
      setInfiniteWallet(Boolean(data.infiniteWallet));
      setFactionBalance(
        typeof data.factionBalance === "number" ? data.factionBalance : null
      );
      setPersonalBdBalance(
        typeof data.personalBdBalance === "number"
          ? data.personalBdBalance
          : null
      );
      setFactionName(
        typeof data.factionName === "string" ? data.factionName : null
      );
      setCanSpendBd(Boolean(data.canSpendBd));
      const members = Array.isArray(data.factionMembers)
        ? (data.factionMembers as FactionMarketMember[])
        : [];
      setFactionMembers(members);
      const me = typeof data.myUserId === "string" ? data.myUserId : null;
      setMyUserId(me);
      setGiftToUserId((prev) => {
        if (prev && members.some((m) => m.userId === prev)) return prev;
        if (me && members.some((m) => m.userId === me)) return me;
        return members[0]?.userId || "";
      });
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

  useEffect(() => {
    const stored = readStoredMarketTab();
    if (stored === "cases" && !canEditPrices) {
      setTab("patches");
      return;
    }
    setTab(stored);
  }, [canEditPrices]);

  function selectMainTab(id: MainTab) {
    if (id === "cases" && !casesUnlocked) {
      setCasesWipOpen(true);
      return;
    }
    setTab(id);
    writeStoredMarketTab(id);
  }

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

  const dealErr: Record<string, string> = {
    insufficient: "Не хватает BBC / $ в казне",
    not_owned: "Нечего продавать — нет копий в инвентаре",
    no_faction: "Нужна фракция: покупка/продажа за $ идёт через казну",
    forbidden_seat: "$ тратит только глава / зам",
    gift_required: "Выбери, кому подарить предмет",
    gift_not_member: "Получатель должен быть из вашей фракции",
  };

  function openBdBuy(draft: BdBuyDraft) {
    setErr(null);
    setMsg(null);
    if (canSpendBd && !giftToUserId) {
      const me = myUserId && factionMembers.some((m) => m.userId === myUserId)
        ? myUserId
        : factionMembers[0]?.userId || "";
      setGiftToUserId(me);
    }
    setBdBuyDraft(draft);
  }

  async function runBuy(opts: {
    catalog: "patch" | "bg" | "font";
    itemId: string;
    giftToUserId?: string;
  }) {
    const key =
      opts.catalog === "patch"
        ? `buy:${opts.itemId}`
        : opts.catalog === "bg"
          ? `buy:bg:${opts.itemId}`
          : `buy:font:${opts.itemId}`;
    setBusy(key);
    setErr(null);
    setMsg(null);
    try {
      const url =
        opts.catalog === "patch"
          ? "/api/bb-coins/patches"
          : opts.catalog === "bg"
            ? "/api/bb-coins/bgs"
            : "/api/bb-coins/fonts";
      const body =
        opts.catalog === "patch"
          ? { action: "buy", patchId: opts.itemId, giftToUserId: opts.giftToUserId }
          : opts.catalog === "bg"
            ? { action: "buy", bgId: opts.itemId, giftToUserId: opts.giftToUserId }
            : {
                action: "buy",
                styleId: opts.itemId,
                giftToUserId: opts.giftToUserId,
              };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErr(dealErr[data.error] || "Не удалось выполнить сделку");
        return;
      }
      if (data.currency === "BD") {
        if (typeof data.balance === "number") setFactionBalance(data.balance);
      } else if (typeof data.balance === "number") {
        setBalance(data.balance);
      }
      const gifted = data.giftedToUserId
        ? factionMembers.find((m) => m.userId === data.giftedToUserId)?.nick
        : null;
      setMsg(
        gifted
          ? `Куплено и подарено: ${gifted}`
          : `Куплено (+1). У тебя: ${data.mine ?? "…"}`
      );
      setBdBuyDraft(null);
      await load();
    } catch {
      setErr("Сеть недоступна");
    } finally {
      setBusy(null);
    }
  }

  async function confirmBdBuy() {
    if (!bdBuyDraft) return;
    await runBuy({
      catalog: bdBuyDraft.catalog,
      itemId: bdBuyDraft.itemId,
      giftToUserId: canSpendBd ? giftToUserId : undefined,
    });
  }

  function requestBuy(
    catalog: "patch" | "bg" | "font",
    card: { id: string; title: string; buy: number; currency?: "BBC" | "BD" }
  ) {
    if (card.currency === "BD") {
      openBdBuy({
        catalog,
        itemId: card.id,
        title: card.title,
        buy: card.buy,
        currency: "BD",
      });
      return;
    }
    void runBuy({ catalog, itemId: card.id });
  }

  async function patchAction(patchId: string, action: "buy" | "sell") {
    if (action === "buy") {
      const card = patches.find((p) => p.id === patchId);
      if (!card) return;
      requestBuy("patch", card);
      return;
    }
    setBusy(`sell:${patchId}`);
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
        setErr(dealErr[data.error] || "Не удалось выполнить сделку");
        return;
      }
      if (data.currency === "BD") {
        if (typeof data.balance === "number") setFactionBalance(data.balance);
        setMsg(
          `Продано (−1). $ вернулись в казну фракции. У тебя: ${data.mine ?? "…"}`
        );
      } else {
        if (typeof data.balance === "number") setBalance(data.balance);
        setMsg(`Продано (−1). У тебя: ${data.mine ?? "…"}`);
      }
      await load();
    } catch {
      setErr("Сеть недоступна");
    } finally {
      setBusy(null);
    }
  }

  async function bgAction(bgId: string, action: "buy" | "sell") {
    if (action === "buy") {
      const card = bgs.find((p) => p.id === bgId);
      if (!card) return;
      requestBuy("bg", card);
      return;
    }
    setBusy(`sell:bg:${bgId}`);
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
        setErr(dealErr[data.error] || "Не удалось выполнить сделку");
        return;
      }
      if (data.currency === "BD") {
        if (typeof data.balance === "number") setFactionBalance(data.balance);
        setMsg(
          `Фон продан (−1). $ вернулись в казну фракции. У тебя: ${data.mine ?? "…"}`
        );
      } else {
        if (typeof data.balance === "number") setBalance(data.balance);
        setMsg(`Фон продан (−1). У тебя: ${data.mine ?? "…"}`);
      }
      await load();
    } catch {
      setErr("Сеть недоступна");
    } finally {
      setBusy(null);
    }
  }

  async function fontAction(styleId: string, action: "buy" | "sell") {
    if (action === "buy") {
      const card = fonts.find((p) => p.id === styleId);
      if (!card) return;
      requestBuy("font", card);
      return;
    }
    setBusy(`sell:font:${styleId}`);
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
        setErr(dealErr[data.error] || "Не удалось выполнить сделку");
        return;
      }
      if (data.currency === "BD") {
        if (typeof data.balance === "number") setFactionBalance(data.balance);
        setMsg(
          `Шрифт продан (−1). $ вернулись в казну фракции. У тебя: ${data.mine ?? "…"}`
        );
      } else {
        if (typeof data.balance === "number") setBalance(data.balance);
        setMsg(`Шрифт продан (−1). У тебя: ${data.mine ?? "…"}`);
      }
      await load();
    } catch {
      setErr("Сеть недоступна");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={`market-page${tab === "cases" ? " market-page--cases" : ""}`}>
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
              <span className="muted">Мой баланс BBC</span>
              <strong>
                {balance == null
                  ? "…"
                  : infiniteWallet
                    ? "∞ BBC"
                    : `${balance.toLocaleString("ru-RU")} BBC`}
              </strong>
            </section>
            <section
              className="market-balance market-balance--faction"
              aria-live="polite"
            >
              <span className="muted">
                Казна фракции
                {factionName ? ` · ${factionName}` : ""}
              </span>
              <strong>
                {infiniteWallet
                  ? "∞ $"
                  : factionBalance == null
                    ? "—"
                    : `${factionBalance.toLocaleString("ru-RU")} $`}
              </strong>
            </section>
            <section
              className="market-balance market-balance--personal-bd"
              aria-live="polite"
            >
              <span className="muted">Мой баланс Черничного доллара</span>
              <strong>
                {infiniteWallet
                  ? "∞ $"
                  : personalBdBalance == null
                    ? "…"
                    : `${personalBdBalance.toLocaleString("ru-RU")} $`}
              </strong>
            </section>
            {canSpendBd ? (
              <button
                type="button"
                className="market-gift-bd-btn"
                onClick={() => setBdGiftOpen(true)}
              >
                Подарить $
              </button>
            ) : null}
            <button
              type="button"
              className="market-topup-btn"
              onClick={() => setTopupWipOpen(true)}
            >
              Пополнить BBC
            </button>
          </div>

          {bdGiftOpen ? (
            <MarketBdGiftModal
              members={factionMembers}
              myUserId={myUserId}
              factionName={factionName}
              factionBalance={factionBalance}
              infiniteWallet={infiniteWallet}
              busy={busy === "gift-bd"}
              onClose={() => setBdGiftOpen(false)}
              onGift={async ({ toUserId, amount }) => {
                setBusy("gift-bd");
                setErr(null);
                setMsg(null);
                try {
                  const res = await fetch("/api/bb-coins/gift-bd", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ toUserId, amount }),
                  });
                  const data = await res.json();
                  if (!res.ok || !data.ok) {
                    setErr(
                      data.message ||
                        (data.error === "insufficient"
                          ? "Не хватает в казне"
                          : data.error === "forbidden_seat"
                            ? "Дарить может только глава / зам"
                            : "Не удалось подарить")
                    );
                    return;
                  }
                  if (typeof data.factionBalance === "number") {
                    setFactionBalance(data.factionBalance);
                  }
                  if (typeof data.personalBdBalance === "number") {
                    setPersonalBdBalance(data.personalBdBalance);
                  }
                  const nick =
                    factionMembers.find((m) => m.userId === toUserId)?.nick ||
                    "игроку";
                  setMsg(
                    `Подарено ${Number(data.amount || amount).toLocaleString("ru-RU")} $ → ${nick}`
                  );
                  setBdGiftOpen(false);
                  await load();
                } catch {
                  setErr("Сеть недоступна");
                } finally {
                  setBusy(null);
                }
              }}
            />
          ) : null}

          {bdBuyDraft ? (
            <MarketBdBuyModal
              draft={bdBuyDraft}
              canSpendBd={canSpendBd}
              members={factionMembers}
              myUserId={myUserId}
              giftToUserId={giftToUserId}
              busy={Boolean(busy)}
              onGiftChange={setGiftToUserId}
              onClose={() => setBdBuyDraft(null)}
              onConfirm={() => void confirmBdBuy()}
            />
          ) : null}

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

          {casesWipOpen ? (
            <div
              className="market-wip-modal"
              role="presentation"
              onClick={() => setCasesWipOpen(false)}
            >
              <div
                className="market-wip-dialog market-cases-wip-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="market-cases-wip-title"
                onClick={(e) => e.stopPropagation()}
              >
                <p id="market-cases-wip-title" className="market-wip-title">
                  Кейсы в разработке
                </p>
                <p className="muted" style={{ marginTop: 8 }}>
                  Скоро откроем сад для всех. Пока вкладка закрыта.
                </p>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setCasesWipOpen(false)}
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
                className={`${t.id === "cases" ? "market-tab-cases" : ""}${
                  tab === t.id ? " is-active" : ""
                }`}
                aria-selected={tab === t.id}
                onClick={() => selectMainTab(t.id)}
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
                        className={`market-price-buy${
                          p.buyDisabled ? " is-buy-disabled" : ""
                        }`}
                        disabled={Boolean(busy) || Boolean(p.buyDisabled)}
                        title={
                          p.buyDisabled
                            ? "Только из кейсов Сада — купить нельзя"
                            : undefined
                        }
                        onClick={() => {
                          if (p.buyDisabled) return;
                          void patchAction(p.id, "buy");
                        }}
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

          {tab === "cases" && casesUnlocked ? (
            <MarketCasesPanel
              onBalances={({ currency, balance }) => {
                if (currency === "BD") setFactionBalance(balance);
                else setBalance(balance);
              }}
              onRefreshCatalog={() => void load()}
            />
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
