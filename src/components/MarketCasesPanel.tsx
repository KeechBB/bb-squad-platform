"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { primeCaseAudio, watchCaseReel } from "@/lib/caseSpinAudio";
import {
  CASE_BOOST_KIND_PRICE,
  CASE_JACKPOT_BTN_PRICE,
  CASE_RED_IMMORTAL_ADD,
  CASE_RED_JACKPOT_ADD_BBC,
  CASE_RED_JACKPOT_ADD,
  CASE_RED_RARE_ADD,
  type CaseBoostKind,
} from "@/lib/marketCaseBoost";

type LootKind = "patch" | "bg" | "empty" | "currency" | "font";

type LootEntry = {
  key: string;
  kind: LootKind;
  itemId: string | null;
  title: string;
  image: string | null;
  cssClass?: string | null;
  price: number;
  sellPrice?: number;
  sellCurrency?: "BBC" | "BD" | null;
  amount?: number;
  chancePct: number;
};

function FontLootSample({
  cssClass,
  size = "md",
}: {
  cssClass?: string | null;
  size?: "sm" | "md" | "xl";
}) {
  return (
    <span
      className={`public-rating-nick-label market-case-font-sample is-${size}${
        cssClass ? ` ${cssClass}` : ""
      }`}
    >
      Keech
    </span>
  );
}

/** Самая редкая категория кейса — Immortal (золотой фон). */
const CASE_IMMORTAL_PATCH_IDS = new Set([
  "creator-svd-faction-lord",
  "creator-gp-drum-berry-lore",
]);

/** Rare — синий фон редкости (РПГ «Урожайный удар»). */
const CASE_RARE_PATCH_IDS = new Set(["creator-rpg7-orchard-harvest"]);

/** Мелочь валюты (100/200/500 BBC · 500/1000/2000 $) — зелёный фон. */
const CASE_FILLER_CASH_IDS = new Set([
  "cash-bbc-100",
  "cash-bbc-200",
  "cash-bbc-500",
  "cash-bd-500",
  "cash-bd-1000",
  "cash-bd-2000",
]);

function isImmortalLoot(e: Pick<LootEntry, "kind" | "itemId">): boolean {
  return Boolean(
    e.kind === "patch" && e.itemId && CASE_IMMORTAL_PATCH_IDS.has(e.itemId)
  );
}

function isRareLoot(e: Pick<LootEntry, "kind" | "itemId">): boolean {
  return Boolean(
    e.kind === "patch" && e.itemId && CASE_RARE_PATCH_IDS.has(e.itemId)
  );
}

function isFillerCashLoot(e: Pick<LootEntry, "kind" | "itemId">): boolean {
  return Boolean(
    e.kind === "currency" && e.itemId && CASE_FILLER_CASH_IDS.has(e.itemId)
  );
}

function lootRarityLabel(e: Pick<LootEntry, "kind" | "itemId">): string | null {
  if (isImmortalLoot(e)) return "Immortal";
  if (isRareLoot(e)) return "Rare";
  return null;
}

function lootCellClass(e: Pick<LootEntry, "kind" | "itemId">): string {
  const extras = [
    isImmortalLoot(e) ? "is-immortal" : "",
    isRareLoot(e) ? "is-rare" : "",
    isFillerCashLoot(e) ? "is-filler-cash" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return `kind-${e.kind}${extras ? ` ${extras}` : ""}`;
}

/** Дольше крутим, чтобы успевать разглядеть скины на ленте. */
const SPIN_MS = 11000;
/** Ширина ячейки ленты — держать в синхроне с CSS `.market-case-roule-cell`. */
const ROULE_CELL_PX = 128;
const ROULE_GAP_PX = 12;

type CaseCard = {
  id: string;
  name: string;
  blurb: string;
  currency: "BBC" | "BD";
  currencyLabel: string;
  price: number;
  image: string;
  loot: LootEntry[];
  nothingChancePct: number;
};

type Props = {
  onBalances?: (opts: {
    currency: "BBC" | "BD";
    balance: number;
    paidFrom?: "treasury" | "personal" | "bbc" | "infinite";
  }) => void;
  onRefreshCatalog?: () => void;
};

type Phase = "idle" | "opening" | "spinning" | "revealed";

type OpenLogRow = {
  id: string;
  n: number;
  at: string;
  caseId: string;
  caseName: string;
  currency: "BBC" | "BD";
  spent: number;
  dropTitle: string;
  dropKind: LootKind;
  dropImage: string | null;
  /** Текущая цена продажи дропа на площадке. */
  dropSell: number;
  dropSellCurrency: "BBC" | "BD" | null;
};

export function MarketCasesPanel({ onBalances, onRefreshCatalog }: Props) {
  const [cases, setCases] = useState<CaseCard[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState<CaseCard | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [strip, setStrip] = useState<LootEntry[]>([]);
  const [landIndex, setLandIndex] = useState(52);
  const [result, setResult] = useState<LootEntry | null>(null);
  const [spinX, setSpinX] = useState(0);
  const [openLog, setOpenLog] = useState<OpenLogRow[]>([]);
  const [inspect, setInspect] = useState<LootEntry | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const logListRef = useRef<HTMLDivElement>(null);
  const spinSoundStop = useRef<(() => void) | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const res = await fetch("/api/bb-coins/cases", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErr("Не удалось загрузить кейсы");
        return;
      }
      if (data.wip || !data.access) {
        setErr("wip");
        return;
      }
      setCases(Array.isArray(data.cases) ? data.cases : []);
    } catch {
      setErr("Сеть недоступна");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => () => spinSoundStop.current?.(), []);

  const priceLabel = (c: CaseCard) =>
    c.currency === "BD"
      ? `${c.price.toLocaleString("ru-RU")} $`
      : `${c.price.toLocaleString("ru-RU")} BBC`;

  const kindPriceLabel = (c: CaseCard, kind: CaseBoostKind) => {
    const n =
      kind === "jackpot"
        ? CASE_JACKPOT_BTN_PRICE
        : c.id === "faction-sad"
          ? CASE_BOOST_KIND_PRICE.red["faction-sad"]
          : CASE_BOOST_KIND_PRICE.red["bbc-urozhay"];
    return c.currency === "BD"
      ? `${n.toLocaleString("ru-RU")} $`
      : `${n.toLocaleString("ru-RU")} BBC`;
  };

  function closeDetail() {
    if (phase === "opening" || phase === "spinning") return;
    setActive(null);
    setPhase("idle");
    setStrip([]);
    setResult(null);
    setSpinX(0);
    setMsg(null);
    setInspect(null);
  }

  async function openCase(c: CaseCard, boostKind?: CaseBoostKind) {
    if (busy) return;
    primeCaseAudio();
    spinSoundStop.current?.();
    spinSoundStop.current = null;
    setBusy(true);
    setErr(null);
    setMsg(null);
    setSpinX(0);
    setStrip([]);
    setPhase("opening");
    setResult(null);
    try {
      // Короткая анимация «открытия» крышки до запроса
      await new Promise((r) => setTimeout(r, 700));
      const res = await fetch("/api/bb-coins/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId: c.id, boostKind }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        const map: Record<string, string> = {
          insufficient:
            "Не хватает средств (личный B$ или казна — смотря кто крутит)",
          no_faction: "Нужна фракция для кейса за $",
          forbidden_seat:
            "Покупку за казну делает глава / зам; кейсы можно крутить с личного B$",
          wip: "Кейсы пока в разработке",
        };
        setErr(map[data.error] || "Не удалось открыть кейс");
        setPhase("idle");
        return;
      }
      if (typeof data.balance === "number" && data.currency) {
        onBalances?.({
          currency: data.currency,
          balance: data.balance,
          paidFrom: data.paidFrom,
        });
      }
      const nextStrip = (data.strip || []) as LootEntry[];
      const land = typeof data.landIndex === "number" ? data.landIndex : 52;
      setStrip(nextStrip);
      setLandIndex(land);
      setResult(data.result as LootEntry);
      setPhase("spinning");

      // Сброс без transition, затем длинный прокрут к выигрышу
      setSpinX(0);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      requestAnimationFrame(() => {
        const viewport = trackRef.current?.parentElement?.clientWidth || 640;
        const center = viewport / 2;
        const target =
          land * (ROULE_CELL_PX + ROULE_GAP_PX) +
          ROULE_CELL_PX / 2 -
          center +
          (Math.random() * 28 - 14);
        setSpinX(-Math.max(0, target));
        const track = trackRef.current;
        const won = data.result as LootEntry;
        const fanfare = isImmortalLoot(won)
          ? "immortal"
          : won.kind === "currency" &&
              won.itemId &&
              !CASE_FILLER_CASH_IDS.has(won.itemId)
            ? "jackpot"
            : null;
        if (track) spinSoundStop.current = watchCaseReel(track, SPIN_MS, fanfare);
      });

      await new Promise((r) => setTimeout(r, SPIN_MS));
      setPhase("revealed");
      const won = data.result as LootEntry;
      setOpenLog((prev) => {
        const sell =
          won.kind === "empty"
            ? 0
            : Math.max(0, Number(won.sellPrice) || 0);
        const sellCur =
          won.kind === "empty"
            ? null
            : won.sellCurrency === "BD" || won.sellCurrency === "BBC"
              ? won.sellCurrency
              : c.currency;
        const row: OpenLogRow = {
          id: `${Date.now()}-${prev.length + 1}`,
          n: prev.length + 1,
          at: new Date().toLocaleTimeString("ru-RU", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
          caseId: c.id,
          caseName: c.name,
          currency: c.currency,
          spent:
            typeof data.spent === "number"
              ? data.spent
              : boostKind === "jackpot"
                ? CASE_JACKPOT_BTN_PRICE
                : boostKind === "red"
                  ? CASE_BOOST_KIND_PRICE.red[
                      c.id === "faction-sad" ? "faction-sad" : "bbc-urozhay"
                    ]
                  : c.price,
          dropTitle: won.kind === "empty" ? "Пусто" : won.title,
          dropKind: won.kind,
          dropImage: won.image,
          dropSell: sell,
          dropSellCurrency: sellCur,
        };
        return [row, ...prev];
      });
      onRefreshCatalog?.();
    } catch {
      setErr("Сеть недоступна");
      setPhase("idle");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    logListRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [openLog.length]);

  const lootSorted = useMemo(() => {
    if (!active) return [];
    return [...active.loot].sort((a, b) => b.chancePct - a.chancePct);
  }, [active]);

  const logStats = useMemo(() => {
    const attempts = openLog.length;
    let spentBbc = 0;
    let spentBd = 0;
    let dropSellBbc = 0;
    let dropSellBd = 0;
    let wins = 0;
    let empties = 0;
    for (const row of openLog) {
      if (row.currency === "BBC") spentBbc += row.spent;
      else spentBd += row.spent;
      if (row.dropKind === "empty") empties += 1;
      else {
        wins += 1;
        if (row.dropSellCurrency === "BBC") dropSellBbc += row.dropSell;
        else if (row.dropSellCurrency === "BD") dropSellBd += row.dropSell;
      }
    }
    return {
      attempts,
      spentBbc,
      spentBd,
      dropSellBbc,
      dropSellBd,
      wins,
      empties,
    };
  }, [openLog]);

  if (err === "wip") {
    return (
      <section className="market-cases market-cases-wip" aria-label="Кейсы">
        <div className="market-cases-wip-dialog" role="status">
          <p className="market-cases-kicker">Фруктовый сад</p>
          <h2>Кейсы</h2>
          <p className="market-note">В разработке</p>
        </div>
      </section>
    );
  }

  return (
    <section className="market-cases" aria-label="Магазин кейсов">
      <div className="market-cases-hero">
        <div className="market-cases-hero-copy">
          <p className="market-cases-kicker">Фруктовый сад · дроп</p>
          <h2>Кейсы Сада</h2>
          <p>
            Два ящика — фракционный за Черничный доллар и общий за BBC. Шансы
            видны до открытия. Вместо пустоты — мелкая валюта кейса.
          </p>
        </div>
      </div>

      {err ? <p className="market-err">{err}</p> : null}
      {msg && !active ? <p className="market-ok">{msg}</p> : null}

      <ul className="market-cases-grid">
        {cases.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              className={`market-case-card currency-${c.currency.toLowerCase()}`}
              onClick={() => {
                setActive(c);
                setPhase("idle");
                setStrip([]);
                setResult(null);
                setMsg(null);
                setSpinX(0);
              }}
            >
              <span className="market-case-badge">
                {c.currency === "BD" ? "КАЗНА $" : "BBC"}
              </span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={c.image} alt="" className="market-case-art" />
              <span className="market-case-name">{c.name}</span>
              <span className="market-case-blurb">{c.blurb}</span>
              <span className="market-case-price">{priceLabel(c)}</span>
              <span className="market-case-hint">
                {c.currency === "BD" ? "мелочь 500–2000 $" : "мелочь 50–200 BBC"}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {active ? (
        <div
          className="market-case-modal"
          role="presentation"
          onClick={closeDetail}
        >
          <div
            className={`market-case-dialog phase-${phase}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="market-case-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="market-case-close"
              onClick={closeDetail}
              disabled={phase === "opening" || phase === "spinning"}
            >
              ×
            </button>

            <aside className="market-case-log" aria-label="Лог открытий">
              <div className="market-case-log-head">
                <h4>Лог сессии</h4>
                <button
                  type="button"
                  className="market-case-log-clear"
                  disabled={!openLog.length || busy}
                  onClick={() => setOpenLog([])}
                >
                  Очистить
                </button>
              </div>
              <div className="market-case-log-stats">
                <div>
                  <span className="muted">Попыток</span>
                  <strong>{logStats.attempts}</strong>
                </div>
                <div>
                  <span className="muted">Дроп / пусто</span>
                  <strong>
                    {logStats.wins} / {logStats.empties}
                  </strong>
                </div>
                <div>
                  <span className="muted">Потрачено BBC</span>
                  <strong>{logStats.spentBbc.toLocaleString("ru-RU")}</strong>
                </div>
                <div>
                  <span className="muted">Потрачено $</span>
                  <strong>{logStats.spentBd.toLocaleString("ru-RU")}</strong>
                </div>
                <div>
                  <span className="muted">Дроп → продажа BBC</span>
                  <strong className="is-gain">
                    {logStats.dropSellBbc.toLocaleString("ru-RU")}
                  </strong>
                </div>
                <div>
                  <span className="muted">Дроп → продажа $</span>
                  <strong className="is-gain">
                    {logStats.dropSellBd.toLocaleString("ru-RU")}
                  </strong>
                </div>
              </div>
              <div className="market-case-log-list" ref={logListRef}>
                {openLog.length === 0 ? (
                  <p className="market-case-log-empty muted">
                    Пока пусто — открой кейс, сюда ляжет каждая попытка.
                  </p>
                ) : (
                  openLog.map((row) => (
                    <article
                      key={row.id}
                      className={`market-case-log-row kind-${row.dropKind}`}
                    >
                      <header>
                        <span className="market-case-log-n">#{row.n}</span>
                        <time>{row.at}</time>
                      </header>
                      <p className="market-case-log-case">{row.caseName}</p>
                      <p className="market-case-log-spent">
                        −{row.spent.toLocaleString("ru-RU")}{" "}
                        {row.currency === "BD" ? "$" : "BBC"}
                      </p>
                      <div className="market-case-log-drop">
                        {row.dropImage ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={row.dropImage} alt="" />
                        ) : (
                          <span className="market-case-empty-glyph">∅</span>
                        )}
                        <span>
                          {row.dropKind === "empty"
                            ? "Пусто"
                            : row.dropTitle}
                        </span>
                      </div>
                      {row.dropKind !== "empty" && row.dropSell > 0 ? (
                        <p className="market-case-log-sell">
                          {row.dropKind === "currency" ? "номинал" : "продажа ≈"}{" "}
                          {row.dropSell.toLocaleString("ru-RU")}{" "}
                          {row.dropSellCurrency === "BD" ? "$" : "BBC"}
                        </p>
                      ) : null}
                    </article>
                  ))
                )}
              </div>
            </aside>

            <div className="market-case-main">
              <div className={`market-case-stage ${phase !== "idle" ? "is-live" : ""}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={active.image}
                  alt=""
                  className={`market-case-stage-art ${
                    phase === "opening" ? "is-opening" : ""
                  } ${
                    phase === "spinning" || phase === "revealed" ? "is-open" : ""
                  }`}
                />
                {phase === "opening" ? (
                  <p className="market-case-stage-label">Открываем ящик…</p>
                ) : null}
              </div>

              <header className="market-case-dialog-head">
                <p className="market-cases-kicker">
                  {active.currency === "BD" ? "Черничный доллар" : "BB Coins"}
                </p>
                <h3 id="market-case-title">{active.name}</h3>
                <p className="market-case-dialog-price">
                  Стоимость: <strong>{priceLabel(active)}</strong>
                </p>
              </header>

              <div
                className="market-case-roulette"
                aria-label="Прокрутка кейса"
              >
                <div className="market-case-roulette-pointer" />
                <div className="market-case-roulette-window">
                  {strip.length > 0 ? (
                    <div
                      ref={trackRef}
                      className="market-case-roulette-track"
                      style={{
                        transform: `translate3d(${spinX}px,0,0)`,
                        transition:
                          phase === "spinning"
                            ? `transform ${SPIN_MS / 1000}s cubic-bezier(0.05, 0.55, 0.08, 1)`
                            : "none",
                      }}
                    >
                      {strip.map((cell, i) => (
                        <div
                          key={`${cell.key}-${i}`}
                          className={`market-case-roule-cell ${lootCellClass(cell)}${
                            phase === "revealed" && i === landIndex
                              ? " is-win"
                              : ""
                          }`}
                        >
                          {cell.kind === "font" ? (
                            <FontLootSample cssClass={cell.cssClass} size="sm" />
                          ) : cell.image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={cell.image} alt="" />
                          ) : (
                            <span className="market-case-empty-glyph">∅</span>
                          )}
                          <span>
                            {cell.kind === "empty" ? "Пусто" : cell.title}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="market-case-roulette-placeholder">
                      Лента появится при открытии
                    </div>
                  )}
                </div>
              </div>

              <div
                className={`market-case-result${
                  phase === "revealed" && result
                    ? ` ${lootCellClass(result)}`
                    : " is-placeholder"
                }`}
                role="status"
              >
                {phase === "revealed" && result ? (
                  result.kind === "empty" ? (
                    <p>Ничего не выпало</p>
                  ) : (
                    <>
                      {result.kind === "font" ? (
                        <FontLootSample cssClass={result.cssClass} size="md" />
                      ) : result.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={result.image} alt="" />
                      ) : null}
                      <div>
                        <strong>{result.title}</strong>
                        <span>
                          {result.kind === "currency"
                            ? "Зачислено на баланс"
                            : "Уже в инвентаре"}
                        </span>
                      </div>
                    </>
                  )
                ) : (
                  <p className="muted">
                    {phase === "opening" || phase === "spinning"
                      ? "Крутим…"
                      : "Результат появится здесь"}
                  </p>
                )}
              </div>

              <div className="market-case-loot-head">
                <h4>Содержимое</h4>
                <p>Нажми на скин · посмотреть крупно</p>
              </div>
              <div className="market-case-loot-scroll">
                {lootSorted.map((e) => (
                  <button
                    key={e.key}
                    type="button"
                    className={`market-case-loot-cell ${lootCellClass(e)}`}
                    title={
                      e.kind === "empty"
                        ? "Пусто"
                        : `Смотреть: ${e.title}`
                    }
                    onClick={() => setInspect(e)}
                  >
                    {e.kind === "font" ? (
                      <FontLootSample cssClass={e.cssClass} size="sm" />
                    ) : e.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={e.image} alt="" />
                    ) : (
                      <span className="market-case-empty-glyph">∅</span>
                    )}
                    {lootRarityLabel(e) ? (
                      <span className="market-case-loot-rarity">
                        {lootRarityLabel(e)}
                      </span>
                    ) : null}
                    <span className="market-case-loot-title">
                      {e.kind === "empty" ? "Пусто" : e.title}
                    </span>
                    <span className="market-case-loot-chance">
                      {e.chancePct.toFixed(2).replace(/\.?0+$/, "")}%
                    </span>
                  </button>
                ))}
              </div>

              <div className="market-case-actions">
                <button
                  type="button"
                  className="market-case-open-btn"
                  disabled={busy || phase === "spinning" || phase === "opening"}
                  onClick={() => void openCase(active)}
                >
                  <span className="market-case-btn-effect">
                    {phase === "revealed" ? "Открыть ещё" : "Открыть"}
                  </span>
                  <span className="market-case-btn-price">{priceLabel(active)}</span>
                </button>
                <button
                  type="button"
                  className="market-case-boost-btn is-red"
                  disabled={busy || phase === "spinning" || phase === "opening"}
                  title={
                    active.id === "bbc-urozhay"
                      ? "Один прокрут. Каждому Rare +7%, джекпоту +1,5%, каждому Immortal +5%."
                      : "Один прокрут. Каждому Rare +7%, джекпоту +3%, каждому Immortal +5%."
                  }
                  onClick={() => void openCase(active, "red")}
                >
                  <span className="market-case-btn-effect">+{CASE_RED_RARE_ADD}% Rare</span>
                  <span className="market-case-btn-effect">
                    {`+${
                      active.id === "bbc-urozhay"
                        ? String(CASE_RED_JACKPOT_ADD_BBC).replace(".", ",")
                        : CASE_RED_JACKPOT_ADD
                    }% Джекпот`}
                  </span>
                  <span className="market-case-btn-effect">+{CASE_RED_IMMORTAL_ADD}% Immortal</span>
                  <span className="market-case-btn-price">{kindPriceLabel(active, "red")}</span>
                </button>
                {active.id === "bbc-urozhay" ? (
                  <button
                    type="button"
                    className="market-case-boost-btn is-jackpot"
                    disabled={busy || phase === "spinning" || phase === "opening"}
                    title="Один прокрут. Повышенный шанс джекпота."
                    onClick={() => void openCase(active, "jackpot")}
                  >
                    <span className="market-case-btn-effect">ДЖЕКПОТ</span>
                    <span className="market-case-btn-effect">повышенный шанс</span>
                    <span className="market-case-btn-price">
                      {kindPriceLabel(active, "jackpot")}
                    </span>
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          {inspect ? (
            <div
              className="market-case-inspect"
              role="dialog"
              aria-modal="true"
              aria-label={
                inspect.kind === "empty" ? "Пусто" : inspect.title
              }
              onClick={(e) => {
                e.stopPropagation();
                setInspect(null);
              }}
            >
              <div
                className="market-case-inspect-card"
                onClick={(ev) => ev.stopPropagation()}
              >
                <button
                  type="button"
                  className="market-case-inspect-close"
                  aria-label="Закрыть"
                  onClick={() => setInspect(null)}
                >
                  ×
                </button>
                <div
                  className={`market-case-inspect-art ${lootCellClass(inspect)}`}
                >
                  {inspect.kind === "font" ? (
                    <FontLootSample cssClass={inspect.cssClass} size="xl" />
                  ) : inspect.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={inspect.image}
                      alt={inspect.title}
                      className={
                        inspect.kind === "patch"
                          ? "is-patch"
                          : inspect.kind === "bg"
                            ? "is-bg"
                            : inspect.kind === "currency"
                              ? "is-currency"
                              : undefined
                      }
                    />
                  ) : (
                    <span className="market-case-empty-glyph is-xl">∅</span>
                  )}
                </div>
                <h4>
                  {inspect.kind === "empty" ? "Пусто" : inspect.title}
                </h4>
                <p className="market-case-inspect-meta">
                  {inspect.kind === "empty"
                    ? "Пустой исход"
                    : inspect.kind === "bg"
                      ? "Фон профиля"
                      : inspect.kind === "font"
                        ? "Шрифт ника"
                      : inspect.kind === "currency"
                        ? "Валюта"
                        : lootRarityLabel(inspect) || "Нашивка"}
                  {" · "}
                  шанс{" "}
                  {inspect.chancePct.toFixed(2).replace(/\.?0+$/, "")}%
                  {inspect.kind !== "empty" &&
                  (inspect.sellPrice ?? 0) > 0 ? (
                    <>
                      {" · "}
                      {inspect.kind === "currency" ? "номинал" : "продажа ≈"}{" "}
                      {(inspect.sellPrice || 0).toLocaleString("ru-RU")}{" "}
                      {inspect.sellCurrency === "BD" ? "$" : "BBC"}
                    </>
                  ) : null}
                </p>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
