"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type LootKind = "patch" | "bg" | "empty";

type LootEntry = {
  key: string;
  kind: LootKind;
  itemId: string | null;
  title: string;
  image: string | null;
  price: number;
  chancePct: number;
};

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
  const trackRef = useRef<HTMLDivElement>(null);
  const logListRef = useRef<HTMLDivElement>(null);

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

  const priceLabel = (c: CaseCard) =>
    c.currency === "BD"
      ? `${c.price.toLocaleString("ru-RU")} $`
      : `${c.price.toLocaleString("ru-RU")} BBC`;

  function closeDetail() {
    if (phase === "opening" || phase === "spinning") return;
    setActive(null);
    setPhase("idle");
    setStrip([]);
    setResult(null);
    setSpinX(0);
    setMsg(null);
  }

  async function openCase(c: CaseCard) {
    if (busy) return;
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
        body: JSON.stringify({ caseId: c.id }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        const map: Record<string, string> = {
          insufficient: "Не хватает средств",
          no_faction: "Нужна фракция для кейса за $",
          forbidden_seat: "$ из казны тратит глава / зам",
          wip: "Кейсы пока в разработке",
        };
        setErr(map[data.error] || "Не удалось открыть кейс");
        setPhase("idle");
        return;
      }
      if (typeof data.balance === "number" && data.currency) {
        onBalances?.({ currency: data.currency, balance: data.balance });
      }
      const nextStrip = (data.strip || []) as LootEntry[];
      const land = typeof data.landIndex === "number" ? data.landIndex : 52;
      setStrip(nextStrip);
      setLandIndex(land);
      setResult(data.result as LootEntry);
      setPhase("spinning");

      // Сдвиг ленты к выигрышной ячейке
      requestAnimationFrame(() => {
        const cell = 108;
        const gap = 10;
        const viewport = trackRef.current?.parentElement?.clientWidth || 640;
        const center = viewport / 2;
        const target =
          land * (cell + gap) + cell / 2 - center + (Math.random() * 24 - 12);
        setSpinX(-Math.max(0, target));
      });

      await new Promise((r) => setTimeout(r, 5200));
      setPhase("revealed");
      const won = data.result as LootEntry;
      if (won.kind === "empty") {
        setMsg("Пусто — в этот раз сад ничего не отдал.");
      } else {
        setMsg(`Выпало: ${won.title}. Уже в инвентаре.`);
      }
      setOpenLog((prev) => {
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
          spent: c.price,
          dropTitle: won.kind === "empty" ? "Пусто" : won.title,
          dropKind: won.kind,
          dropImage: won.image,
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
    let wins = 0;
    let empties = 0;
    for (const row of openLog) {
      if (row.currency === "BBC") spentBbc += row.spent;
      else spentBd += row.spent;
      if (row.dropKind === "empty") empties += 1;
      else wins += 1;
    }
    return { attempts, spentBbc, spentBd, wins, empties };
  }, [openLog]);

  if (err === "wip") {
    return (
      <p className="market-note">Кейсы пока в разработке.</p>
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
            видны до открытия. Около половины круток — пусто.
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
                Пусто ~{Math.round(c.nothingChancePct)}%
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

              {(phase === "spinning" || phase === "revealed") &&
              strip.length > 0 ? (
                <div
                  className="market-case-roulette"
                  aria-label="Прокрутка кейса"
                >
                  <div className="market-case-roulette-pointer" />
                  <div className="market-case-roulette-window">
                    <div
                      ref={trackRef}
                      className="market-case-roulette-track"
                      style={{
                        transform: `translate3d(${spinX}px,0,0)`,
                        transition:
                          phase === "spinning"
                            ? "transform 5s cubic-bezier(0.12, 0.75, 0.08, 1)"
                            : "none",
                      }}
                    >
                      {strip.map((cell, i) => (
                        <div
                          key={`${cell.key}-${i}`}
                          className={`market-case-roule-cell kind-${cell.kind}${
                            phase === "revealed" && i === landIndex
                              ? " is-win"
                              : ""
                          }`}
                        >
                          {cell.image ? (
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
                  </div>
                </div>
              ) : null}

              {phase === "revealed" && result ? (
                <div
                  className={`market-case-result kind-${result.kind}`}
                  role="status"
                >
                  {result.kind === "empty" ? (
                    <p>Ничего не выпало</p>
                  ) : (
                    <>
                      {result.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={result.image} alt="" />
                      ) : null}
                      <div>
                        <strong>{result.title}</strong>
                        <span>Уже в инвентаре</span>
                      </div>
                    </>
                  )}
                </div>
              ) : null}

              {msg ? <p className="market-ok">{msg}</p> : null}

              <div className="market-case-loot-head">
                <h4>Содержимое</h4>
                <p>Листай · шанс дропа у каждой ячейки</p>
              </div>
              <div className="market-case-loot-scroll">
                {lootSorted.map((e) => (
                  <div
                    key={e.key}
                    className={`market-case-loot-cell kind-${e.kind}`}
                    title={e.title}
                  >
                    {e.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={e.image} alt="" />
                    ) : (
                      <span className="market-case-empty-glyph">∅</span>
                    )}
                    <span className="market-case-loot-title">
                      {e.kind === "empty" ? "Пусто" : e.title}
                    </span>
                    <span className="market-case-loot-chance">
                      {e.chancePct.toFixed(2).replace(/\.?0+$/, "")}%
                    </span>
                  </div>
                ))}
              </div>

              <div className="market-case-actions">
                <button
                  type="button"
                  className="market-case-open-btn"
                  disabled={busy || phase === "spinning" || phase === "opening"}
                  onClick={() => void openCase(active)}
                >
                  {phase === "revealed"
                    ? `Открыть ещё · ${priceLabel(active)}`
                    : `Открыть · ${priceLabel(active)}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
