"use client";

import { useMemo, useState } from "react";
import {
  confidenceLabel,
  formatMatchDate,
  type UpcomingMatchPreview,
} from "@/lib/kvForecastUi";

type Props = {
  previews: UpcomingMatchPreview[];
};

const MONTHS = [
  "январь",
  "февраль",
  "март",
  "апрель",
  "май",
  "июнь",
  "июль",
  "август",
  "сентябрь",
  "октябрь",
  "ноябрь",
  "декабрь",
];

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function mskToday() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(new Date());
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value || 0);
  return { year: n("year"), month: n("month"), day: n("day") };
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function mondayIndex(year: number, month: number) {
  const js = new Date(year, month - 1, 1).getDay();
  return js === 0 ? 6 : js - 1;
}

function pctTone(winPct: number) {
  if (winPct >= 55) return "is-good";
  if (winPct <= 42) return "is-bad";
  return "";
}

function statusLabel(status: string) {
  if (status === "win") return "Победа";
  if (status === "lose") return "Поражение";
  if (status === "draw") return "Ничья";
  if (status === "upcoming") return "Скоро";
  if (status === "cancel") return "Отмена";
  return "Матч";
}

function WinRing({ pct, tone }: { pct: number; tone: string }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  const dash = (clamped / 100) * c;
  return (
    <div className={`home-winring ${tone}`.trim()} aria-hidden="true">
      <svg viewBox="0 0 44 44" width="44" height="44">
        <circle className="home-winring-track" cx="22" cy="22" r={r} />
        <circle
          className="home-winring-value"
          cx="22"
          cy="22"
          r={r}
          strokeDasharray={`${dash} ${c}`}
          transform="rotate(-90 22 22)"
        />
      </svg>
      <span className="home-winring-num">{pct}%</span>
    </div>
  );
}

export function HomeMonthCalendar({ previews }: Props) {
  const today = useMemo(() => mskToday(), []);
  const [cursor, setCursor] = useState(() => ({
    year: today.year,
    month: today.month,
  }));
  const [day, setDay] = useState<number | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const byDay = useMemo(() => {
    const map = new Map<number, UpcomingMatchPreview[]>();
    for (const m of previews) {
      if (m.year !== cursor.year || m.month !== cursor.month) continue;
      const list = map.get(m.day) || [];
      list.push(m);
      map.set(m.day, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.timeMsk.localeCompare(b.timeMsk));
    }
    return map;
  }, [previews, cursor.year, cursor.month]);

  const selected = useMemo(
    () => previews.find((m) => m.key === selectedKey) || null,
    [previews, selectedKey]
  );

  const cells = useMemo(() => {
    const lead = mondayIndex(cursor.year, cursor.month);
    const count = daysInMonth(cursor.year, cursor.month);
    const out: Array<number | null> = [
      ...Array.from({ length: lead }, () => null),
      ...Array.from({ length: count }, (_, i) => i + 1),
    ];
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [cursor.year, cursor.month]);

  function shiftMonth(delta: number) {
    setDay(null);
    setSelectedKey(null);
    setCursor((cur) => {
      const d = new Date(cur.year, cur.month - 1 + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() + 1 };
    });
  }

  const dayMatches = day != null ? byDay.get(day) || [] : [];

  return (
    <section className="home-ops-board home-cal-board" aria-label="Календарь КВ">
      <header className="home-ops-head home-cal-head">
        <div>
          <p className="home-ops-eyebrow">клановые войны</p>
          <h2>Календарь</h2>
        </div>
        <div className="home-cal-nav">
          <button type="button" onClick={() => shiftMonth(-1)} aria-label="Предыдущий месяц">
            ‹
          </button>
          <strong>
            {MONTHS[cursor.month - 1]} {cursor.year}
          </strong>
          <button type="button" onClick={() => shiftMonth(1)} aria-label="Следующий месяц">
            ›
          </button>
        </div>
      </header>

      {selected ? (
        <div className="home-match-detail">
          <button
            type="button"
            className="home-match-back"
            onClick={() => setSelectedKey(null)}
          >
            ← К {selected.day} {MONTHS[selected.month - 1]}
          </button>
          <div className="home-match-detail-top">
            <div>
              <p className="home-match-detail-when muted">
                {formatMatchDate(selected.day, selected.month, selected.year)} ·{" "}
                {selected.timeMsk} МСК · {statusLabel(selected.status)}
                {selected.meeting ? ` · ${selected.meeting}` : ""}
              </p>
              <h3 className="home-match-detail-vs">
                <span className="home-match-bb">BB</span>
                <span className="home-match-vs-sep">vs</span>
                <span className="home-match-opp">{selected.opp}</span>
              </h3>
              <p className="home-match-meta">
                {selected.map} · {selected.stack} · {selected.size}
              </p>
            </div>
            <WinRing
              pct={selected.forecast.winPct}
              tone={pctTone(selected.forecast.winPct)}
            />
          </div>
          <div
            className="home-match-bar"
            aria-hidden="true"
            title={`W ${selected.forecast.winPct}% · D ${selected.forecast.drawPct}% · L ${selected.forecast.losePct}%`}
          >
            <i style={{ width: `${selected.forecast.winPct}%` }} className="w" />
            <i style={{ width: `${selected.forecast.drawPct}%` }} className="d" />
            <i style={{ width: `${selected.forecast.losePct}%` }} className="l" />
          </div>
          <p className="home-match-confidence muted">
            {selected.status === "upcoming"
              ? confidenceLabel(selected.forecast.confidence)
              : "Разбор по составу, последнему выходу и личным встречам"}
          </p>
          <p className="home-match-summary">{selected.forecast.summary}</p>
          <ul className="home-match-factors">
            {selected.forecast.factors.map((fac) => (
              <li key={fac.label} className={`tone-${fac.tone}`}>
                <span>{fac.label}</span>
                <strong>{fac.value}</strong>
              </li>
            ))}
          </ul>
          {selected.note ? (
            <p className="home-match-note muted">Заметка: {selected.note}</p>
          ) : null}
        </div>
      ) : (
        <>
          <div className="home-cal-weekdays" aria-hidden="true">
            {WEEKDAYS.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
          <div className="home-cal-grid">
            {cells.map((n, i) => {
              if (n == null) {
                return <div key={`e${i}`} className="home-cal-cell is-empty" />;
              }
              const list = byDay.get(n) || [];
              const isToday =
                n === today.day &&
                cursor.month === today.month &&
                cursor.year === today.year;
              const open = day === n;
              return (
                <button
                  key={n}
                  type="button"
                  className={`home-cal-cell${list.length ? " has-match" : ""}${
                    isToday ? " is-today" : ""
                  }${open ? " is-open" : ""}`}
                  onClick={() => setDay(open ? null : n)}
                >
                  <span className="home-cal-num">{n}</span>
                  <span className="home-cal-chips">
                    {list.slice(0, 2).map((m) => (
                      <span
                        key={m.key}
                        className={`home-cal-chip is-${m.status || "play"}`}
                        title={`${m.stack} vs ${m.opp}`}
                      >
                        {m.stack === "Junior" ? "J" : "M"} {m.opp}
                      </span>
                    ))}
                    {list.length > 2 ? (
                      <span className="home-cal-more">+{list.length - 2}</span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>

          {day != null ? (
            <div className="home-cal-day">
              <p className="home-cal-day-title">
                {day} {MONTHS[cursor.month - 1]}
                <button type="button" onClick={() => setDay(null)}>
                  закрыть
                </button>
              </p>
              {dayMatches.length === 0 ? (
                <p className="muted home-cal-empty">В этот день игр нет.</p>
              ) : (
                <ul className="home-cal-events">
                  {dayMatches.map((m) => (
                    <li key={m.key}>
                      <button type="button" onClick={() => setSelectedKey(m.key)}>
                        <span className={`home-cal-pip is-${m.status || "play"}`} />
                        <span className="home-cal-event-main">
                          <strong>
                            {m.timeMsk} · {m.stack} vs {m.opp}
                          </strong>
                          <em>
                            {statusLabel(m.status)}
                            {m.meeting ? ` · ${m.meeting}` : ""} · {m.mapShort} · {m.size}
                          </em>
                        </span>
                        <span className="home-cal-event-go">разбор</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <p className="home-cal-hint muted">
              Нажми день — игры этого дня. На игру — состав, личные и разбор.
            </p>
          )}
        </>
      )}
    </section>
  );
}
