"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { primeCaseAudio, watchCaseReel } from "@/lib/caseSpinAudio";
import {
  CASE_BOOST_KIND_PRICE,
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
const CASE_JACKPOT_BBC_ID = "cash-bbc-200000";
const CASE_JACKPOT_BD_ID = "cash-bd-1000000";

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

type JackpotPools = { BBC: number; BD: number };

function jackpotLiveTitle(e: Pick<LootEntry, "itemId" | "title">, pools: JackpotPools | null): string {
  if (!pools) return e.title;
  if (e.itemId === CASE_JACKPOT_BBC_ID) {
    return `${pools.BBC.toLocaleString("ru-RU")} BBC`;
  }
  if (e.itemId === CASE_JACKPOT_BD_ID) {
    return `${pools.BD.toLocaleString("ru-RU")} $`;
  }
  return e.title;
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
  const [strip2, setStrip2] = useState<LootEntry[]>([]);
  const [landIndex, setLandIndex] = useState(52);
  const [landIndex2, setLandIndex2] = useState(52);
  const [result, setResult] = useState<LootEntry | null>(null);
  const [result2, setResult2] = useState<LootEntry | null>(null);
  const [spinX, setSpinX] = useState(0);
  const [spinX2, setSpinX2] = useState(0);
  const [spinCount, setSpinCount] = useState<1 | 2>(1);
  const [openLog, setOpenLog] = useState<OpenLogRow[]>([]);
  const [inspect, setInspect] = useState<LootEntry | null>(null);
  const [jackpots, setJackpots] = useState<JackpotPools | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const trackRef2 = useRef<HTMLDivElement>(null);
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
      if (data.jackpots?.BBC && data.jackpots?.BD) {
        setJackpots({ BBC: Number(data.jackpots.BBC), BD: Number(data.jackpots.BD) });
      }
    } catch {
      setErr("Сеть недоступна");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const res = await fetch("/api/bb-coins/case-jackpot", { cache: "no-store" });
        const data = await res.json();
        if (stop || !data.ok || !data.jackpots) return;
        setJackpots({
          BBC: Number(data.jackpots.BBC) || 0,
          BD: Number(data.jackpots.BD) || 0,
        });
      } catch {
        /* следующий тик */
      }
    };
    void tick();
    const timer = window.setInterval(tick, 2000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => () => spinSoundStop.current?.(), []);

  const priceLabel = (c: CaseCard) =>
    c.currency === "BD"
      ? `${c.price.toLocaleString("ru-RU")} $`
      : `${c.price.toLocaleString("ru-RU")} BBC`;

  const moneyLabel = (c: CaseCard, amount: number) =>
    c.currency === "BD"
      ? `${amount.toLocaleString("ru-RU")} $`
      : `${amount.toLocaleString("ru-RU")} BBC`;

  const kindUnit = (c: CaseCard, kind: CaseBoostKind) => {
    void kind;
    return c.id === "faction-sad"
      ? CASE_BOOST_KIND_PRICE.red["faction-sad"]
      : CASE_BOOST_KIND_PRICE.red["bbc-urozhay"];
  };

  function closeDetail() {
    if (phase === "opening" || phase === "spinning") return;
    setActive(null);
    setPhase("idle");
    setStrip([]);
    setStrip2([]);
    setResult(null);
    setResult2(null);
    setSpinX(0);
    setSpinX2(0);
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
    setSpinX2(0);
    setStrip([]);
    setStrip2([]);
    setPhase("opening");
    setResult(null);
    setResult2(null);
    try {
      // Короткая анимация «открытия» крышки до запроса
      await new Promise((r) => setTimeout(r, 700));
      const res = await fetch("/api/bb-coins/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId: c.id, boostKind, count: spinCount }),
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
      if (data.jackpots?.BBC && data.jackpots?.BD) {
        setJackpots({ BBC: Number(data.jackpots.BBC), BD: Number(data.jackpots.BD) });
      }
      if (typeof data.balance === "number" && data.currency) {
        onBalances?.({
          currency: data.currency,
          balance: data.balance,
          paidFrom: data.paidFrom,
        });
      }
      type SpinPayload = {
        result: LootEntry;
        strip: LootEntry[];
        landIndex: number;
        spent?: number;
      };
      const spins: SpinPayload[] =
        Array.isArray(data.spins) && data.spins.length
          ? (data.spins as SpinPayload[])
          : [
              {
                result: data.result as LootEntry,
                strip: (data.strip || []) as LootEntry[],
                landIndex: typeof data.landIndex === "number" ? data.landIndex : 52,
                spent: typeof data.spent === "number" ? data.spent : undefined,
              },
            ];
      const first = spins[0];
      const second = spins[1] || null;
      const land = typeof first.landIndex === "number" ? first.landIndex : 52;
      const land2 = second && typeof second.landIndex === "number" ? second.landIndex : 52;
      setStrip(first.strip || []);
      setLandIndex(land);
      setResult(first.result);
      setStrip2(second?.strip || []);
      setLandIndex2(land2);
      setResult2(second?.result || null);
      setPhase("spinning");

      // Сброс без transition, затем длинный прокрут к выигрышу
      setSpinX(0);
      setSpinX2(0);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      requestAnimationFrame(() => {
        const aim = (track: HTMLDivElement | null, landAt: number) => {
          const viewport = track?.parentElement?.clientWidth || 640;
          const center = viewport / 2;
          const target =
            landAt * (ROULE_CELL_PX + ROULE_GAP_PX) +
            ROULE_CELL_PX / 2 -
            center +
            (Math.random() * 28 - 14);
          return -Math.max(0, target);
        };
        setSpinX(aim(trackRef.current, land));
        if (second) setSpinX2(aim(trackRef2.current, land2));
        const wonList = spins.map((spin) => spin.result);
        const fanfare = wonList.some((won) => isImmortalLoot(won))
          ? "immortal"
          : wonList.some(
                (won) =>
                  won.kind === "currency" &&
                  won.itemId &&
                  !CASE_FILLER_CASH_IDS.has(won.itemId)
              )
            ? "jackpot"
            : null;
        const track = trackRef.current;
        if (track) spinSoundStop.current = watchCaseReel(track, SPIN_MS, fanfare);
      });

      await new Promise((r) => setTimeout(r, SPIN_MS));
      setPhase("revealed");
      const unitFallback =
        boostKind === "red" ? kindUnit(c, "red") : c.price;
      setOpenLog((prev) => {
        const rows = spins.map((spin, index) => {
          const won = spin.result;
          const sell =
            won.kind === "empty" ? 0 : Math.max(0, Number(won.sellPrice) || 0);
          const sellCur =
            won.kind === "empty"
              ? null
              : won.sellCurrency === "BD" || won.sellCurrency === "BBC"
                ? won.sellCurrency
                : c.currency;
          const row: OpenLogRow = {
            id: `${Date.now()}-${prev.length + index + 1}`,
            n: prev.length + index + 1,
            at: new Date().toLocaleTimeString("ru-RU", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            }),
            caseId: c.id,
            caseName: c.name,
            currency: c.currency,
            spent: typeof spin.spent === "number" ? spin.spent : unitFallback,
            dropTitle: won.kind === "empty" ? "Пусто" : won.title,
            dropKind: won.kind,
            dropImage: won.image,
            dropSell: sell,
            dropSellCurrency: sellCur,
          };
          return row;
        });
        return [...rows].reverse().concat(prev);
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
                setStrip2([]);
                setResult(null);
                setResult2(null);
                setMsg(null);
                setSpinX(0);
                setSpinX2(0);
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
              <span className="market-case-jackpot-live">
                Джекпот{" "}
                {jackpots
                  ? c.currency === "BD"
                    ? `${jackpots.BD.toLocaleString("ru-RU")} $`
                    : `${jackpots.BBC.toLocaleString("ru-RU")} BBC`
                  : "…"}
              </span>
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
            className={`market-case-dialog phase-${phase}${spinCount === 2 ? " is-x2" : ""}`}
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
                <p className="market-case-jackpot-live">
                  Джекпот{" "}
                  <strong>
                    {jackpots
                      ? active.currency === "BD"
                        ? `${jackpots.BD.toLocaleString("ru-RU")} $`
                        : `${jackpots.BBC.toLocaleString("ru-RU")} BBC`
                      : "…"}
                  </strong>
                </p>
              </header>

              {(
                [
                  { cells: strip, land: landIndex, x: spinX, ref: trackRef },
                  ...(spinCount === 2
                    ? [{ cells: strip2, land: landIndex2, x: spinX2, ref: trackRef2 }]
                    : []),
                ] as const
              ).map((reel, reelIndex) => (
              <div
                key={reelIndex}
                className="market-case-roulette"
                aria-label={reelIndex === 0 ? "Прокрутка кейса" : "Вторая прокрутка"}
              >
                <div className="market-case-roulette-pointer" />
                <div className="market-case-roulette-window">
                  {reel.cells.length > 0 ? (
                    <div
                      ref={reel.ref}
                      className="market-case-roulette-track"
                      style={{
                        transform: `translate3d(${reel.x}px,0,0)`,
                        transition:
                          phase === "spinning"
                            ? `transform ${SPIN_MS / 1000}s cubic-bezier(0.05, 0.55, 0.08, 1)`
                            : "none",
                      }}
                    >
                      {reel.cells.map((cell, i) => (
                        <div
                          key={`${cell.key}-${reelIndex}-${i}`}
                          className={`market-case-roule-cell ${lootCellClass(cell)}${
                            phase === "revealed" && i === reel.land
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
              ))}

              <div className="market-case-results">
                {(spinCount === 2 ? [result, result2] : [result]).map((drop, dropIndex) => (
                  <div
                    key={dropIndex}
                    className={`market-case-result${
                      phase === "revealed" && drop
                        ? ` ${lootCellClass(drop)}`
                        : " is-placeholder"
                    }`}
                    role="status"
                  >
                    {phase === "revealed" && drop ? (
                      drop.kind === "empty" ? (
                        <p>Ничего не выпало</p>
                      ) : (
                        <>
                          {drop.kind === "font" ? (
                            <FontLootSample cssClass={drop.cssClass} size="md" />
                          ) : drop.image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={drop.image} alt="" />
                          ) : null}
                          <div>
                            <strong>{drop.title}</strong>
                            <span>
                              {drop.kind === "currency"
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
                ))}
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
                        : `Смотреть: ${jackpotLiveTitle(e, jackpots)}`
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
                      {e.kind === "empty" ? "Пусто" : jackpotLiveTitle(e, jackpots)}
                    </span>
                    <span className="market-case-loot-chance">
                      {e.chancePct.toFixed(2).replace(/\.?0+$/, "")}%
                    </span>
                  </button>
                ))}
              </div>

              <div className="market-case-mult" role="group" aria-label="Сколько прокрутов">
                <button
                  type="button"
                  className={spinCount === 1 ? "is-on" : ""}
                  disabled={busy || phase === "spinning" || phase === "opening"}
                  onClick={() => setSpinCount(1)}
                >
                  х1
                </button>
                <button
                  type="button"
                  className={spinCount === 2 ? "is-on" : ""}
                  disabled={busy || phase === "spinning" || phase === "opening"}
                  onClick={() => setSpinCount(2)}
                >
                  х2
                </button>
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
                  <span className="market-case-btn-price">
                    {moneyLabel(active, active.price * spinCount)}
                  </span>
                </button>
                <button
                  type="button"
                  className="market-case-boost-btn is-red"
                  disabled={busy || phase === "spinning" || phase === "opening"}
                  title={
                    active.id === "bbc-urozhay"
                      ? `${spinCount === 2 ? "Два прокрута" : "Один прокрут"}. Каждому Rare +7%, джекпоту +1,5%, каждому Immortal +5%.`
                      : `${spinCount === 2 ? "Два прокрута" : "Один прокрут"}. Каждому Rare +7%, джекпоту +3%, каждому Immortal +5%.`
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
                  <span className="market-case-btn-price">
                    {moneyLabel(active, kindUnit(active, "red") * spinCount)}
                  </span>
                </button>
              </div>
            </div>
          </div>

          {inspect ? (
            <div
              className="market-case-inspect"
              role="dialog"
              aria-modal="true"
              aria-label={
                inspect.kind === "empty" ? "Пусто" : jackpotLiveTitle(inspect, jackpots)
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
                  {inspect.kind === "empty"
                    ? "Пусто"
                    : jackpotLiveTitle(inspect, jackpots)}
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
