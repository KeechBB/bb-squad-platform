"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CompareSide } from "@/lib/playerCompare";
import { HitmapSilhouette } from "@/components/HitmapSilhouette";

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

function NickPicker({
  label,
  value,
  draft,
  onDraft,
  onPick,
  suggestions,
}: {
  label: string;
  value: string;
  draft: string;
  onDraft: (v: string) => void;
  onPick: (nick: string) => void;
  suggestions: string[];
}) {
  const show =
    draft.trim().length > 0 &&
    draft.trim().toLowerCase() !== value.trim().toLowerCase();

  const commitExact = () => {
    const q = draft.trim().toLowerCase();
    if (!q) return;
    const hit =
      suggestions.find((n) => n.toLowerCase() === q) ||
      suggestions.find((n) => n.toLowerCase().startsWith(q));
    if (hit) {
      onPick(hit);
      onDraft(hit);
    }
  };

  return (
    <label className="compare-search">
      <span className="muted">{label}</span>
      <input
        value={draft}
        onChange={(e) => onDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitExact();
          }
        }}
        placeholder="Ник…"
        autoComplete="off"
      />
      {show && suggestions.length > 0 ? (
        <ul className="compare-suggest">
          {suggestions.map((n) => (
            <li key={n}>
              <button
                type="button"
                onClick={() => {
                  onPick(n);
                  onDraft(n);
                }}
              >
                {n}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </label>
  );
}

function SideBlock({ side }: { side: CompareSide }) {
  const train = side.train;
  const cw = side.cw;
  return (
    <div className="compare-side">
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

function TrainHist({ side }: { side: CompareSide }) {
  return (
    <section className="compare-hist-block">
      <h4>Тренировки · {side.nick}</h4>
      <ul className="compare-hist-list">
        {side.trainHistory.length === 0 ? (
          <li className="muted">Нет матчей</li>
        ) : (
          side.trainHistory.slice(0, 16).map((m) => (
            <li key={`t-${side.nick}-${m.matchId}`}>
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
  );
}

function CwHist({ side }: { side: CompareSide }) {
  return (
    <section className="compare-hist-block">
      <h4>КВ · {side.nick}</h4>
      <ul className="compare-hist-list">
        {side.cwHistory.length === 0 ? (
          <li className="muted">Нет матчей</li>
        ) : (
          side.cwHistory.slice(0, 12).map((m) => (
            <li key={`c-${side.nick}-${m.matchId}`}>
              <span>{m.dateLabel}</span>
              <span title={m.opp}>vs {m.opp}</span>
              <span>{m.meeting || "—"}</span>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}

function HitmapSide({ side }: { side: CompareSide }) {
  const hm = side.hitmap || {
    bones: {},
    total: 0,
    lastBone: null,
    zones: { head: 0, torso: 0, limb: 0 },
  };
  const total = hm.total || 0;
  const z = hm.zones || { head: 0, torso: 0, limb: 0 };
  return (
    <section className="compare-hitmap-side">
      <h4>Попадания · {side.nick}</h4>
      <p className="muted compare-hitmap-total">
        Всего: <strong>{total}</strong>
      </p>
      {total > 0 ? (
        <>
          <div className="compare-hitmap-body">
            <HitmapSilhouette
              bones={hm.bones}
              total={total}
              lastBone={hm.lastBone}
              compact
              className="compare-hitmap-svg"
            />
          </div>
          <ul className="compare-hitmap-zones">
            <li>
              <span>Голова</span>
              <b>{z.head}%</b>
            </li>
            <li>
              <span>Торс</span>
              <b>{z.torso}%</b>
            </li>
            <li>
              <span>Конечности</span>
              <b>{z.limb}%</b>
            </li>
          </ul>
        </>
      ) : (
        <p className="muted compare-hitmap-empty">Нет данных попаданий</p>
      )}
    </section>
  );
}

export function ProfileCompareCard({ myNick }: Props) {
  const [open, setOpen] = useState(false);
  const [nicks, setNicks] = useState<string[]>([]);
  const [left, setLeft] = useState(myNick);
  const [right, setRight] = useState("");
  const [leftDraft, setLeftDraft] = useState(myNick);
  const [rightDraft, setRightDraft] = useState("");
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
    setLeft(myNick);
    setLeftDraft(myNick);
    setRight("");
    setRightDraft("");
    setData(null);
    setError(null);
    setCalOpen(false);
    fetch("/api/player-compare?list=1", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { nicks: [] }))
      .then((j) => setNicks(Array.isArray(j.nicks) ? j.nicks : []))
      .catch(() => setNicks([]));
  }, [open, myNick]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  const filterSuggest = useCallback(
    (draft: string, lockedOther: string) => {
      const q = draft.trim().toLowerCase();
      const otherLow = lockedOther.trim().toLowerCase();
      return nicks
        .filter((n) => {
          const low = n.toLowerCase();
          if (otherLow && low === otherLow) return false;
          if (!q) return true;
          return low.includes(q);
        })
        .slice(0, 10);
    },
    [nicks]
  );

  const leftSuggestions = useMemo(
    () => filterSuggest(leftDraft, right),
    [filterSuggest, leftDraft, right]
  );
  const rightSuggestions = useMemo(
    () => filterSuggest(rightDraft, left),
    [filterSuggest, rightDraft, left]
  );

  const loadCompare = useCallback(async () => {
    if (!left.trim() || !right.trim()) {
      setError("Выбери обоих игроков");
      return;
    }
    if (left.trim().toLowerCase() === right.trim().toLowerCase()) {
      setError("Выбери двух разных игроков");
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        me: left.trim(),
        other: right.trim(),
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
  }, [left, right, from, to]);

  useEffect(() => {
    if (!open || !left || !right) return;
    void loadCompare();
  }, [open, left, right, from, to, loadCompare]);

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
          Любой игрок с любым: RP, ТМ/КВ и матчи по датам.
        </p>
        <button
          type="button"
          className="profile-compare-open-btn"
          onClick={() => setOpen(true)}
        >
          Сравнить игроков
        </button>
      </section>

      {open ? (
        <div
          className="compare-overlay"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="compare-panel">
            <header className="compare-panel-head">
              <div className="compare-panel-title">
                <h2>Сравнение игроков</h2>
                <p className="muted">{periodLabel}</p>
              </div>
              <button
                type="button"
                className="compare-close"
                aria-label="Закрыть"
                onClick={() => setOpen(false)}
              >
                ✕
              </button>
            </header>

            <div className="compare-body">
              <div className="compare-controls">
                <NickPicker
                  label="Игрок A"
                  value={left}
                  draft={leftDraft}
                  onDraft={(v) => {
                    setLeftDraft(v);
                    setLeft("");
                    setData(null);
                  }}
                  onPick={(n) => setLeft(n)}
                  suggestions={leftSuggestions}
                />

                <div className="compare-cal-wrap">
                  <span className="muted">Период</span>
                  <button
                    type="button"
                    className={`compare-cal-toggle${calOpen ? " is-open" : ""}`}
                    onClick={() => setCalOpen((v) => !v)}
                  >
                    {periodLabel}
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
                            day === from ||
                            day === to ||
                            (from && to && day >= from && day <= to);
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

                <NickPicker
                  label="Игрок B"
                  value={right}
                  draft={rightDraft}
                  onDraft={(v) => {
                    setRightDraft(v);
                    setRight("");
                    setData(null);
                  }}
                  onPick={(n) => setRight(n)}
                  suggestions={rightSuggestions}
                />
              </div>

              {error ? <p className="error">{error}</p> : null}
              {loading ? <p className="muted">Считаем сравнение…</p> : null}

              {data ? (
                <>
                  <div className="compare-vs">
                    <SideBlock side={data.me} />
                    <div className="compare-vs-mid">
                      <span>VS</span>
                      <div className="compare-diff">
                        <div className={deltaCls(data.me.rp, data.other.rp)}>
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
                    <SideBlock side={data.other} />
                  </div>

                  <div className="compare-hist-pair compare-hitmap-pair">
                    <HitmapSide side={data.me} />
                    <div className="compare-hist-gutter compare-hitmap-mid">
                      <span className="muted">куда бьют</span>
                      <div className="compare-diff">
                        <div
                          className={deltaCls(
                            data.me.hitmap?.zones.head ?? null,
                            data.other.hitmap?.zones.head ?? null
                          )}
                        >
                          Голова
                          {data.me.hitmap && data.other.hitmap
                            ? (() => {
                                const d =
                                  Math.round(
                                    (data.me.hitmap.zones.head -
                                      data.other.hitmap.zones.head) *
                                      10
                                  ) / 10;
                                return ` ${d > 0 ? `+${d}` : String(d)}`;
                              })()
                            : ""}
                        </div>
                        <div
                          className={deltaCls(
                            data.me.hitmap?.zones.torso ?? null,
                            data.other.hitmap?.zones.torso ?? null
                          )}
                        >
                          Торс
                        </div>
                        <div
                          className={deltaCls(
                            data.me.hitmap?.zones.limb ?? null,
                            data.other.hitmap?.zones.limb ?? null,
                            false
                          )}
                          title="Меньше конечностей обычно лучше"
                        >
                          Конечн.
                        </div>
                      </div>
                    </div>
                    <HitmapSide side={data.other} />
                  </div>

                  <div className="compare-hist-pair">
                    <TrainHist side={data.me} />
                    <div className="compare-hist-gutter" aria-hidden />
                    <TrainHist side={data.other} />
                  </div>
                  <div className="compare-hist-pair">
                    <CwHist side={data.me} />
                    <div className="compare-hist-gutter" aria-hidden />
                    <CwHist side={data.other} />
                  </div>
                </>
              ) : (
                !loading && (
                  <p className="muted compare-hint">
                    Выбери игрока слева и справа — откроется разбор.
                  </p>
                )
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
