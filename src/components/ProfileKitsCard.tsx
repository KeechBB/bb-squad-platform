"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { subscribeLive } from "@/lib/liveClient";
import {
  KIT_SLICE_COLORS,
  type KitPctRow,
} from "@/lib/squadKits";

type KitsLane = "TR1" | "PB1";

type Props = {
  userId?: string | null;
  /** Соперник без аккаунта — киты по Steam */
  steamId?: string | null;
  kits?: KitPctRow[];
  /** Показывать переключатель TR1+TR2 | PB1 */
  allowTr1?: boolean;
  /** Скрыть выбор сервера (режим паб/трени/КВ снаружи) */
  hideLaneToggle?: boolean;
  /** Стартовая лента (BB → TR1, остальные → PB1) */
  initialLane?: KitsLane;
  /** false — без фильтра залитых TM (гости / соперники) */
  combatWindow?: boolean;
};

type Mode = "all" | "day" | "range";

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

function donutPaths(
  rows: KitPctRow[],
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number
): { d: string; color: string; kit: string; pct: number }[] {
  if (!rows.length) return [];
  const total = rows.reduce((s, r) => s + r.pct, 0) || 100;
  let angle = -Math.PI / 2;
  const gap = 0.035;
  const out: { d: string; color: string; kit: string; pct: number }[] = [];
  rows.forEach((row, i) => {
    const sweep = (row.pct / total) * (Math.PI * 2 - gap * rows.length);
    const a0 = angle;
    const a1 = angle + sweep;
    angle = a1 + gap;
    const x0o = cx + rOuter * Math.cos(a0);
    const y0o = cy + rOuter * Math.sin(a0);
    const x1o = cx + rOuter * Math.cos(a1);
    const y1o = cy + rOuter * Math.sin(a1);
    const x0i = cx + rInner * Math.cos(a1);
    const y0i = cy + rInner * Math.sin(a1);
    const x1i = cx + rInner * Math.cos(a0);
    const y1i = cy + rInner * Math.sin(a0);
    const large = sweep > Math.PI ? 1 : 0;
    const d = [
      `M ${x0o} ${y0o}`,
      `A ${rOuter} ${rOuter} 0 ${large} 1 ${x1o} ${y1o}`,
      `L ${x0i} ${y0i}`,
      `A ${rInner} ${rInner} 0 ${large} 0 ${x1i} ${y1i}`,
      "Z",
    ].join(" ");
    out.push({
      d,
      color: KIT_SLICE_COLORS[i % KIT_SLICE_COLORS.length],
      kit: row.kit,
      pct: row.pct,
    });
  });
  return out;
}

export function ProfileKitsCard({
  userId,
  steamId,
  kits: initialKits,
  allowTr1 = false,
  hideLaneToggle = false,
  initialLane,
  combatWindow = true,
}: Props) {
  const uid = useId().replace(/:/g, "");
  const identityKey = userId || steamId || "";
  const defaultLane: KitsLane = allowTr1
    ? initialLane === "PB1"
      ? "PB1"
      : "TR1"
    : "PB1";
  const [lane, setLane] = useState<KitsLane>(defaultLane);
  const [kits, setKits] = useState<KitPctRow[]>(initialKits || []);
  const [mode, setMode] = useState<Mode>("all");
  const [day, setDay] = useState<string | null>(null);
  const [rangeFrom, setRangeFrom] = useState<string | null>(null);
  const [rangeTo, setRangeTo] = useState<string | null>(null);
  const [rangePick, setRangePick] = useState<"from" | "to">("from");
  const [kitDays, setKitDays] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [calOpen, setCalOpen] = useState(false);
  const today = todayMskYmd();
  const todayParts = parseYmd(today)!;
  const [viewY, setViewY] = useState(todayParts.y);
  const [viewM, setViewM] = useState(todayParts.m);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setKits(initialKits || []);
  }, [initialKits, identityKey]);

  useEffect(() => {
    if (!allowTr1 && lane !== "PB1") setLane("PB1");
  }, [allowTr1, lane]);

  const load = useCallback(
    async (
      opts: {
        day?: string | null;
        from?: string | null;
        to?: string | null;
        lane?: KitsLane;
      },
      withDays: boolean
    ) => {
      if (!userId && !steamId) return;
      setLoading(true);
      try {
        const q = new URLSearchParams();
        if (userId) q.set("userId", userId);
        else if (steamId) q.set("steamId", steamId);
        q.set("lane", opts.lane || lane);
        if (!combatWindow) q.set("combat", "0");
        if (opts.day) q.set("day", opts.day);
        if (opts.from) q.set("from", opts.from);
        if (opts.to) q.set("to", opts.to);
        if (withDays) q.set("days", "1");
        const res = await fetch(`/api/kits?${q}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as {
          kits?: KitPctRow[];
          days?: string[];
        };
        setKits(Array.isArray(data.kits) ? data.kits : []);
        if (Array.isArray(data.days)) setKitDays(new Set(data.days));
      } catch {
        /* keep previous */
      } finally {
        setLoading(false);
      }
    },
    [userId, steamId, lane, combatWindow]
  );

  useEffect(() => {
    void load({ lane }, true);
  }, [load, lane]);

  useEffect(() => {
    return subscribeLive("/api/live/me", "user", (raw) => {
      try {
        const msg = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (msg?.type === "kits" || msg?.type === "hitmap") {
          void load(
            {
              day: mode === "day" ? day : null,
              from: mode === "range" ? rangeFrom : null,
              to: mode === "range" ? rangeTo : null,
            },
            false
          );
        }
      } catch {
        /* ignore */
      }
    });
  }, [load, mode, day, rangeFrom, rangeTo]);

  useEffect(() => {
    if (!calOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setCalOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [calOpen]);

  const selectAll = () => {
    setMode("all");
    setDay(null);
    setRangeFrom(null);
    setRangeTo(null);
    setCalOpen(false);
    void load({}, false);
  };

  const selectDayMode = () => {
    setMode("day");
    setRangeFrom(null);
    setRangeTo(null);
    const d = day || today;
    setDay(d);
    setViewY(parseYmd(d)!.y);
    setViewM(parseYmd(d)!.m);
    setCalOpen(true);
    void load({ day: d }, false);
  };

  const selectRangeMode = () => {
    setMode("range");
    setDay(null);
    setRangePick("from");
    setCalOpen(true);
    if (rangeFrom && rangeTo) {
      void load({ from: rangeFrom, to: rangeTo }, false);
    }
  };

  const onCalDay = (ymdStr: string) => {
    if (mode === "day") {
      setDay(ymdStr);
      setCalOpen(false);
      void load({ day: ymdStr }, false);
      return;
    }
    if (mode === "range") {
      if (rangePick === "from" || !rangeFrom) {
        setRangeFrom(ymdStr);
        setRangeTo(null);
        setRangePick("to");
        return;
      }
      let from = rangeFrom;
      let to = ymdStr;
      if (from > to) {
        const t = from;
        from = to;
        to = t;
      }
      setRangeFrom(from);
      setRangeTo(to);
      setRangePick("from");
      setCalOpen(false);
      void load({ from, to }, false);
    }
  };

  const shiftMonth = (delta: number) => {
    let m = viewM + delta;
    let y = viewY;
    while (m < 1) {
      m += 12;
      y -= 1;
    }
    while (m > 12) {
      m -= 12;
      y += 1;
    }
    setViewY(y);
    setViewM(m);
  };

  const calCells = useMemo(() => {
    const first = new Date(Date.UTC(viewY, viewM - 1, 1));
    const start = (first.getUTCDay() + 6) % 7;
    const daysInMonth = new Date(Date.UTC(viewY, viewM, 0)).getUTCDate();
    const cells: Array<{ day: number | null; ymd: string | null }> = [];
    for (let i = 0; i < start; i++) cells.push({ day: null, ymd: null });
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ day: d, ymd: ymd(viewY, viewM, d) });
    }
    while (cells.length % 7 !== 0) cells.push({ day: null, ymd: null });
    return cells;
  }, [viewY, viewM]);

  const slices = useMemo(
    () => donutPaths(kits, 60, 60, 54, 28),
    [kits]
  );
  const top = kits[0] || null;
  const [hoverKit, setHoverKit] = useState<string | null>(null);
  const active =
    (hoverKit && slices.find((s) => s.kit === hoverKit)) ||
    (top
      ? {
          kit: top.kit,
          pct: top.pct,
          color: KIT_SLICE_COLORS[0],
        }
      : null);
  const activePct =
    active &&
    (Number.isInteger(active.pct)
      ? `${active.pct}%`
      : `${active.pct.toFixed(1)}%`);
  const activeLabel = active
    ? active.kit.length > 18
      ? `${active.kit.slice(0, 17)}…`
      : active.kit
    : "";

  const periodLabel =
    mode === "day" && day
      ? formatRuDay(day)
      : mode === "range" && rangeFrom && rangeTo
        ? `${formatRuDay(rangeFrom)}–${formatRuDay(rangeTo)}`
        : mode === "range" && rangeFrom
          ? `с ${formatRuDay(rangeFrom)}…`
          : "всё время";

  const monthTitle = new Intl.DateTimeFormat("ru-RU", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(viewY, viewM - 1, 1)));

  return (
    <section
      className={
        calOpen
          ? "card profile-pwr-card profile-kits-card is-cal-open"
          : "card profile-pwr-card profile-kits-card"
      }
    >
      <div className="profile-kv-head">
        <div className="profile-kits-title-row">
          <h2>Роли</h2>
          {hideLaneToggle ? null : allowTr1 ? (
            <div
              className="training-server-toggle profile-kits-lane-toggle"
              role="group"
              aria-label="Сервер ролей"
            >
              <button
                type="button"
                className={`btn ghost${lane === "TR1" ? " active" : ""}`}
                aria-pressed={lane === "TR1"}
                onClick={() => setLane("TR1")}
                title="Тренировка TR1+TR2"
              >
                TR1+TR2
              </button>
              <button
                type="button"
                className={`btn ghost${lane === "PB1" ? " active" : ""}`}
                aria-pressed={lane === "PB1"}
                onClick={() => setLane("PB1")}
                title="Паблик PB1"
              >
                PB1
              </button>
            </div>
          ) : (
            <span className="muted profile-kits-lane-label">PB1</span>
          )}
        </div>
        <div className="profile-kits-filter" ref={wrapRef}>
          <button
            type="button"
            className={
              mode === "all"
                ? "profile-hitmap-filter-btn is-active"
                : "profile-hitmap-filter-btn"
            }
            onClick={selectAll}
          >
            Всё время
          </button>
          <button
            type="button"
            className={
              mode === "day"
                ? "profile-hitmap-filter-btn is-active"
                : "profile-hitmap-filter-btn"
            }
            onClick={selectDayMode}
          >
            День
          </button>
          <button
            type="button"
            className={
              mode === "range"
                ? "profile-hitmap-filter-btn is-active"
                : "profile-hitmap-filter-btn"
            }
            onClick={selectRangeMode}
          >
            Интервал
          </button>
          {calOpen && (mode === "day" || mode === "range") ? (
            <div className="profile-hitmap-cal profile-kits-cal" role="dialog">
              <div className="profile-hitmap-cal-nav">
                <button type="button" onClick={() => shiftMonth(-1)} aria-label="Пред. месяц">
                  ‹
                </button>
                <strong>{monthTitle}</strong>
                <button type="button" onClick={() => shiftMonth(1)} aria-label="След. месяц">
                  ›
                </button>
              </div>
              {mode === "range" ? (
                <p className="muted profile-kits-cal-hint">
                  {rangePick === "from" || !rangeFrom
                    ? "Выбери начало"
                    : "Выбери конец"}
                </p>
              ) : null}
              <div className="profile-hitmap-cal-dow">
                {["пн", "вт", "ср", "чт", "пт", "сб", "вс"].map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </div>
              <div className="profile-hitmap-cal-grid">
                {calCells.map((c, i) => {
                  if (!c.ymd || c.day == null) {
                    return <span key={`e-${i}`} className="profile-hitmap-cal-empty" />;
                  }
                  const has = kitDays.has(c.ymd);
                  const isSel =
                    (mode === "day" && day === c.ymd) ||
                    (mode === "range" &&
                      (c.ymd === rangeFrom ||
                        c.ymd === rangeTo ||
                        (rangeFrom &&
                          rangeTo &&
                          c.ymd >= rangeFrom &&
                          c.ymd <= rangeTo)));
                  return (
                    <button
                      key={c.ymd}
                      type="button"
                      className={[
                        "profile-hitmap-cal-day",
                        has ? "has-hits" : "",
                        c.ymd === today ? "is-today" : "",
                        isSel ? "is-selected" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => onCalDay(c.ymd!)}
                    >
                      {c.day}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <p className="muted profile-kits-period">
        {loading ? "Обновляем…" : periodLabel}
        {!loading && lane === "TR1" && combatWindow
          ? " · только залитые тренировочные матчи"
          : ""}
        {!loading && lane === "TR1" && !combatWindow
          ? " · TR1+TR2 · весь день"
          : ""}
        {!loading && lane === "PB1" ? " · PB1 · весь день" : ""}
      </p>

      {kits.length === 0 ? (
        <p className="muted profile-kits-empty">
          {lane === "PB1"
            ? "Пока нет стандартных китов на PB1 за этот период."
            : combatWindow
              ? "Пока нет китов в залитых тренировочных матчах за этот период (Jensens AFK не считается)."
              : "Пока нет стандартных китов на TR1/TR2 за этот период."}
        </p>
      ) : (
        <div
          className="profile-kits-body profile-kits-body-solo"
          onMouseLeave={() => setHoverKit(null)}
        >
          <svg
            className="profile-kits-donut"
            viewBox="0 0 120 120"
            role="img"
            aria-label={`Роли: ${active ? `${active.kit} ${activePct}` : ""}`}
          >
            <defs>
              <filter id={`kits-glow-${uid}`} x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="0.6" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <filter id={`kits-pop-${uid}`} x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="1.2" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            {slices.map((s) => {
              const isHover = hoverKit === s.kit;
              const dim = hoverKit != null && !isHover;
              return (
                <path
                  key={s.kit}
                  d={s.d}
                  fill={s.color}
                  className={
                    isHover
                      ? "profile-kits-slice is-hover"
                      : dim
                        ? "profile-kits-slice is-dim"
                        : "profile-kits-slice"
                  }
                  filter={
                    isHover
                      ? `url(#kits-pop-${uid})`
                      : `url(#kits-glow-${uid})`
                  }
                  onMouseEnter={() => setHoverKit(s.kit)}
                  onFocus={() => setHoverKit(s.kit)}
                  tabIndex={0}
                  role="img"
                  aria-label={`${s.kit}: ${
                    Number.isInteger(s.pct) ? s.pct : s.pct.toFixed(1)
                  }%`}
                />
              );
            })}
            <circle cx="60" cy="60" r="24" className="profile-kits-donut-hole" />
            {active ? (
              <>
                <text
                  x="60"
                  y="54"
                  textAnchor="middle"
                  className="profile-kits-donut-pct"
                >
                  {activePct}
                </text>
                <text
                  x="60"
                  y="70"
                  textAnchor="middle"
                  className="profile-kits-donut-label"
                >
                  {activeLabel}
                </text>
              </>
            ) : null}
          </svg>
        </div>
      )}
    </section>
  );
}
