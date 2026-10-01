"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CompareSide } from "@/lib/playerCompare";

type Props = {
  myNick: string;
};

type ComparePayload = {
  from: string | null;
  to: string | null;
  me: CompareSide;
  other: CompareSide;
};

function todayMskYmd(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function parseYmd(s: string): { y: number; m: number; d: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  return { y, m, d };
}

function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function formatRuDay(ymdStr: string): string {
  const p = parseYmd(ymdStr);
  if (!p) return ymdStr;
  return `${String(p.d).padStart(2, "0")}.${String(p.m).padStart(2, "0")}.${p.y}`;
}

function fmtNum(n: number | null | undefined, digits = 0) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  const v = Number(n);
  return digits > 0 ? v.toFixed(digits) : String(Math.round(v));
}

function deltaCls(a: number | null, b: number | null, higherBetter = true) {
  if (a == null || b == null) return "";
  if (a === b) return "is-tie";
  const win = higherBetter ? a > b : a < b;
  return win ? "is-win" : "is-lose";
}

function SideBlock({
  side,
  accent,
}: {
  side: CompareSide;
  accent: "me" | "other";
}) {
  const train = side.train;
  const cw = side.cw;
  return (
    <div className={`compare-side compare-side-${accent}`}>
      <header className="compare-side-head">
        <h3>{side.nick}</h3>
        <div className="compare-rp-row">
          <span className={`home-pwr-badge rank-${side.rankKey}`}>
            {side.rankLabel}
          </span>
          <strong>{side.rp != null ? Math.round(side.rp) : "—"}</strong>
          <span className="muted">RP</span>
          {side.place != null ? (
            <span className="muted compare-place">#{side.place}</span>
          ) : null}
        </div>
      </header>

      <div className="compare-stats-grid">
        <div>
          <span className="muted">ТМ каток</span>
          <strong>{fmtNum(train?.matches)}</strong>
        </div>
        <div>
          <span className="muted">ТМ W%</span>
          <strong>
            {train?.winrate != null ? `${fmtNum(train.winrate, 1)}%` : "—"}
          </strong>
        </div>
        <div>
          <span className="muted">ТМ KD</span>
          <strong>{train ? fmtNum(train.kd, 2) : "—"}</strong>
        </div>
        <div>
          <span className="muted">ТМ килы</span>
          <strong>{fmtNum(train?.kills)}</strong>
        </div>
        <div>
          <span className="muted">КВ встреч</span>
          <strong>{fmtNum(cw?.matches)}</strong>
        </div>
        <div>
          <span className="muted">КВ W%</span>
          <strong>
            {cw?.winrate != null ? `${fmtNum(cw.winrate, 1)}%` : "—"}
          </strong>
        </div>
        <div>
          <span className="muted">КВ KD</span>
          <strong>{cw ? fmtNum(cw.kd, 2) : "—"}</strong>
        </div>
        <div>
          <span className="muted">КВ килы</span>
          <strong>{fmtNum(cw?.kills)}</strong>
        </div>
      </div>

      {side.kits.length > 0 ? (
        <div className="compare-kits">
          <span className="muted">Топ роли</span>
          <ul>
            {side.kits.slice(0, 4).map((k) => (
              <li key={k.kit}>
                <span>{k.kit}</span>
                <b>{Math.round(k.pct * 10) / 10}%</b>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function ProfileCompareCard({ myNick }: Props) {
  const [open, setOpen] = useState(false);
  const [nicks, setNicks] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [other, setOther] = useState("");
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [pick, setPick] = useState<"from" | "to">("from");
  const [calOpen, setCalOpen] = useState(false);
  const today = todayMskYmd();
  const todayParts = parseYmd(today)!;
  const [viewY, setViewY] = useState(todayParts.y);
  const [viewM, setViewM] = useState(todayParts.m);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ComparePayload | null>(null);

  useEffect(() => {
    if (!open) return;
    fetch("/api/player-compare?list=1", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { nicks: [] }))
      .then((j) => setNicks(Array.isArray(j.nicks) ? j.nicks : []))
      .catch(() => setNicks([]));
  }, [open]);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = nicks.filter(
      (n) => n.toLowerCase() !== myNick.trim().toLowerCase()
    );
    if (!q) return base.slice(0, 12);
    return base.filter((n) => n.toLowerCase().includes(q)).slice(0, 12);
  }, [nicks, query, myNick]);

  const loadCompare = useCallback(async () => {
    if (!other.trim()) {
      setError("Выбери игрока");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        me: myNick,
        other: other.trim(),
      });
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      const res = await fetch(`/api/player-compare?${qs}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Не удалось сравнить");
      }
      const payload = (await res.json()) as ComparePayload;
      setData(payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [myNick, other, from, to]);

  useEffect(() => {
    if (!open || !other) return;
    void loadCompare();
  }, [open, other, from, to, loadCompare]);

  const daysInMonth = useMemo(() => {
    const last = new Date(viewY, viewM, 0).getDate();
    const firstDow = (new Date(viewY, viewM - 1, 1).getDay() + 6) % 7;
    const cells: (number | null)[] = [];
    for (let i = 0; i < firstDow; i++) cells.push(null);
    for (let d = 1; d <= last; d++) cells.push(d);
    return cells;
  }, [viewY, viewM]);

  const monthLabel = useMemo(() => {
    return new Intl.DateTimeFormat("ru-RU", {
      month: "long",
      year: "numeric",
    }).format(new Date(viewY, viewM - 1, 1));
  }, [viewY, viewM]);

  const periodLabel =
    from || to
      ? `${from ? formatRuDay(from) : "…"} — ${to ? formatRuDay(to) : "…"}`
      : "Все даты";

  return (
    <>
      <section className="card profile-compare-card">
        <div className="profile-kv-head">
          <h2>Сравнение</h2>
        </div>
        <p className="muted profile-compare-lead">
          Себя с любым игроком: RP, ТМ/КВ стата и матчи по датам.
        </p>
        <button
          type="button"
          className="profile-compare-open-btn"
          onClick={() => setOpen(true)}
        >
          Сравнить с игроком
        </button>
      </section>

      {open ? (
        <div className="compare-overlay" role="dialog" aria-modal="true">
          <div className="compare-panel">
            <header className="compare-panel-head">
              <div>
                <h2>Сравнение игроков</h2>
                <p className="muted">{periodLabel}</p>
              </div>
              <button
                type="button"
                className="rp-breakdown-close"
                onClick={() => setOpen(false)}
              >
                ✕
              </button>
            </header>

            <div className="compare-controls">
              <label className="compare-search">
                <span className="muted">Игрок</span>
                <input
                  value={query || other}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setOther("");
                    setData(null);
                  }}
                  placeholder="Ник…"
                  autoComplete="off"
                />
                {query && !other && suggestions.length > 0 ? (
                  <ul className="compare-suggest">
                    {suggestions.map((n) => (
                      <li key={n}>
                        <button
                          type="button"
                          onClick={() => {
                            setOther(n);
                            setQuery(n);
                          }}
                        >
                          {n}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </label>

              <div className="compare-cal-wrap">
                <button
                  type="button"
                  className={`compare-cal-toggle${calOpen ? " is-open" : ""}`}
                  onClick={() => setCalOpen((v) => !v)}
                >
                  Календарь · {periodLabel}
                </button>
                {(from || to) && (
                  <button
                    type="button"
                    className="compare-cal-clear"
                    onClick={() => {
                      setFrom(null);
                      setTo(null);
                      setPick("from");
                    }}
                  >
                    Сбросить даты
                  </button>
                )}
                {calOpen ? (
                  <div className="compare-cal">
                    <div className="compare-cal-nav">
                      <button
                        type="button"
                        onClick={() => {
                          if (viewM === 1) {
                            setViewY((y) => y - 1);
                            setViewM(12);
                          } else setViewM((m) => m - 1);
                        }}
                      >
                        ‹
                      </button>
                      <strong>{monthLabel}</strong>
                      <button
                        type="button"
                        onClick={() => {
                          if (viewM === 12) {
                            setViewY((y) => y + 1);
                            setViewM(1);
                          } else setViewM((m) => m + 1);
                        }}
                      >
                        ›
                      </button>
                    </div>
                    <div className="compare-cal-pick">
                      <button
                        type="button"
                        className={pick === "from" ? "is-active" : ""}
                        onClick={() => setPick("from")}
                      >
                        С {from ? formatRuDay(from) : "…"}
                      </button>
                      <button
                        type="button"
                        className={pick === "to" ? "is-active" : ""}
                        onClick={() => setPick("to")}
                      >
                        По {to ? formatRuDay(to) : "…"}
                      </button>
                    </div>
                    <div className="compare-cal-grid">
                      {["пн", "вт", "ср", "чт", "пт", "сб", "вс"].map((d) => (
                        <span key={d} className="muted">
                          {d}
                        </span>
                      ))}
                      {daysInMonth.map((d, i) => {
                        if (d == null) return <span key={`e-${i}`} />;
                        const day = ymd(viewY, viewM, d);
                        const selected =
                          day === from || day === to || (from && to && day >= from && day <= to);
                        return (
                          <button
                            key={day}
                            type="button"
                            className={selected ? "is-selected" : ""}
                            onClick={() => {
                              if (pick === "from") {
                                setFrom(day);
                                if (to && day > to) setTo(null);
                                setPick("to");
                              } else {
                                if (from && day < from) {
                                  setFrom(day);
                                  setTo(from);
                                } else setTo(day);
                                setPick("from");
                              }
                            }}
                          >
                            {d}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            {error ? <p className="error">{error}</p> : null}
            {loading ? <p className="muted">Считаем сравнение…</p> : null}

            {data ? (
              <>
                <div className="compare-vs">
                  <SideBlock side={data.me} accent="me" />
                  <div className="compare-vs-mid">
                    <span>VS</span>
                    <div className="compare-diff">
                      <div
                        className={deltaCls(data.me.rp, data.other.rp)}
                        title="RP"
                      >
                        RP{" "}
                        {data.me.rp != null && data.other.rp != null
                          ? Math.round(data.me.rp - data.other.rp) > 0
                            ? `+${Math.round(data.me.rp - data.other.rp)}`
                            : String(Math.round(data.me.rp - data.other.rp))
                          : "—"}
                      </div>
                      <div
                        className={deltaCls(
                          data.me.train?.kd ?? null,
                          data.other.train?.kd ?? null
                        )}
                      >
                        ТМ KD
                      </div>
                      <div
                        className={deltaCls(
                          data.me.cw?.kd ?? null,
                          data.other.cw?.kd ?? null
                        )}
                      >
                        КВ KD
                      </div>
                    </div>
                  </div>
                  <SideBlock side={data.other} accent="other" />
                </div>

                <div className="compare-hist-grid">
                  <section>
                    <h4>Тренировки · {data.me.nick}</h4>
                    <ul className="compare-hist-list">
                      {data.me.trainHistory.length === 0 ? (
                        <li className="muted">Нет матчей</li>
                      ) : (
                        data.me.trainHistory.slice(0, 20).map((m) => (
                          <li key={`mt-${m.matchId}`}>
                            <span>{m.dateLabel}</span>
                            <span title={m.map}>{m.map}</span>
                            <span
                              className={
                                m.rpDelta == null
                                  ? ""
                                  : m.rpDelta > 0
                                    ? "plus"
                                    : m.rpDelta < 0
                                      ? "minus"
                                      : ""
                              }
                            >
                              {m.rpDelta == null
                                ? "—"
                                : m.rpDelta > 0
                                  ? `+${m.rpDelta}`
                                  : String(m.rpDelta)}
                            </span>
                          </li>
                        ))
                      )}
                    </ul>
                  </section>
                  <section>
                    <h4>Тренировки · {data.other.nick}</h4>
                    <ul className="compare-hist-list">
                      {data.other.trainHistory.length === 0 ? (
                        <li className="muted">Нет матчей</li>
                      ) : (
                        data.other.trainHistory.slice(0, 20).map((m) => (
                          <li key={`ot-${m.matchId}`}>
                            <span>{m.dateLabel}</span>
                            <span title={m.map}>{m.map}</span>
                            <span
                              className={
                                m.rpDelta == null
                                  ? ""
                                  : m.rpDelta > 0
                                    ? "plus"
                                    : m.rpDelta < 0
                                      ? "minus"
                                      : ""
                              }
                            >
                              {m.rpDelta == null
                                ? "—"
                                : m.rpDelta > 0
                                  ? `+${m.rpDelta}`
                                  : String(m.rpDelta)}
                            </span>
                          </li>
                        ))
                      )}
                    </ul>
                  </section>
                  <section>
                    <h4>КВ · {data.me.nick}</h4>
                    <ul className="compare-hist-list">
                      {data.me.cwHistory.length === 0 ? (
                        <li className="muted">Нет матчей</li>
                      ) : (
                        data.me.cwHistory.slice(0, 16).map((m) => (
                          <li key={`mc-${m.matchId}`}>
                            <span>{m.dateLabel}</span>
                            <span title={m.opp}>vs {m.opp}</span>
                            <span>{m.meeting || "—"}</span>
                          </li>
                        ))
                      )}
                    </ul>
                  </section>
                  <section>
                    <h4>КВ · {data.other.nick}</h4>
                    <ul className="compare-hist-list">
                      {data.other.cwHistory.length === 0 ? (
                        <li className="muted">Нет матчей</li>
                      ) : (
                        data.other.cwHistory.slice(0, 16).map((m) => (
                          <li key={`oc-${m.matchId}`}>
                            <span>{m.dateLabel}</span>
                            <span title={m.opp}>vs {m.opp}</span>
                            <span>{m.meeting || "—"}</span>
                          </li>
                        ))
                      )}
                    </ul>
                  </section>
                </div>
              </>
            ) : !loading && other ? null : (
              !loading && (
                <p className="muted" style={{ marginTop: 12 }}>
                  Выбери ника справа — откроется разбор.
                </p>
              )
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
