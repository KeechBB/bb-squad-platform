"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  confidenceLabel,
  formatMatchDate,
  type UpcomingMatchPreview,
} from "@/lib/kvForecast";

type Props = {
  previews: UpcomingMatchPreview[];
};

export function HomeUpcomingMatches({ previews }: Props) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = useMemo(
    () => previews.find((m) => m.key === selectedKey) || null,
    [previews, selectedKey]
  );

  return (
    <section className="home-upcoming-window" aria-label="Предстоящие матчи">
      <header className="home-upcoming-head">
        <p className="eyebrow">прогноз ИИ · КВ</p>
        <h2>Предстоящие матчи</h2>
      </header>

      {previews.length === 0 ? (
        <p className="muted home-upcoming-empty">
          Ближайших матчей пока нет.{" "}
          <Link href="/cw">Календарь КВ →</Link>
        </p>
      ) : selected ? (
        <div className="home-match-detail">
          <button
            type="button"
            className="home-match-back"
            onClick={() => setSelectedKey(null)}
          >
            ← К списку
          </button>

          <div className="home-match-detail-top">
            <div>
              <p className="home-match-detail-when muted">
                {formatMatchDate(selected.day, selected.month, selected.year)} ·{" "}
                {selected.timeMsk} МСК
              </p>
              <h3 className="home-match-detail-vs">
                <span className="home-match-bb">BB</span>
                <span className="home-match-vs-sep">vs</span>
                <span className="home-match-opp">{selected.opp}</span>
              </h3>
              <p className="home-match-meta">
                {selected.mapShort} · {selected.stack} · {selected.size}
              </p>
            </div>
            <div
              className={`home-match-pct${
                selected.forecast.winPct >= 55
                  ? " is-good"
                  : selected.forecast.winPct <= 42
                    ? " is-bad"
                    : ""
              }`}
              title={confidenceLabel(selected.forecast.confidence)}
            >
              <span className="home-match-pct-num">
                {selected.forecast.winPct}%
              </span>
              <span className="home-match-pct-label">победа</span>
            </div>
          </div>

          <div
            className="home-match-bar"
            aria-hidden="true"
            title={`W ${selected.forecast.winPct}% · D ${selected.forecast.drawPct}% · L ${selected.forecast.losePct}%`}
          >
            <i
              style={{ width: `${selected.forecast.winPct}%` }}
              className="w"
            />
            <i
              style={{ width: `${selected.forecast.drawPct}%` }}
              className="d"
            />
            <i
              style={{ width: `${selected.forecast.losePct}%` }}
              className="l"
            />
          </div>

          <p className="home-match-confidence muted">
            {confidenceLabel(selected.forecast.confidence)}
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
          <ul className="home-match-rows">
            {previews.map((m) => {
              const f = m.forecast;
              return (
                <li key={m.key}>
                  <button
                    type="button"
                    className="home-match-row"
                    onClick={() => setSelectedKey(m.key)}
                  >
                    <span className="home-match-row-date">
                      {String(m.day).padStart(2, "0")}.{String(m.month).padStart(2, "0")}{" "}
                      {m.timeMsk}
                    </span>
                    <span className="home-match-row-vs">
                      BB–{m.opp}
                    </span>
                    <span className="home-match-row-map muted">
                      {m.mapShort} · {m.stack}
                    </span>
                    <span
                      className={`home-match-row-pct${
                        f.winPct >= 55
                          ? " is-good"
                          : f.winPct <= 42
                            ? " is-bad"
                            : ""
                      }`}
                    >
                      {f.winPct}%
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="home-upcoming-foot">
            <Link href="/cw">Календарь КВ →</Link>
          </p>
        </>
      )}
    </section>
  );
}
